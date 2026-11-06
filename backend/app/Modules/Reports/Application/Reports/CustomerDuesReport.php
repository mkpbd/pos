<?php

namespace App\Modules\Reports\Application\Reports;

use App\Modules\Reports\Application\Contracts\Report;
use App\Modules\Reports\Application\ReportContext;
use App\Modules\Reports\Application\ReportResult;
use App\Modules\Reports\Application\Support\AgingBuckets;
use App\Modules\Reports\Application\Support\Sql;
use App\Modules\Reports\Domain\Aging;
use App\Modules\Reports\Domain\ReportColumn;
use App\Modules\Reports\Domain\ReportDefinition;
use App\Modules\Reports\Domain\ReportGroup;
use App\Modules\Reports\Domain\ReportParam;
use App\Modules\Shared\Domain\ValueObjects\Decimal;
use Carbon\CarbonImmutable;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;

/**
 * Customer dues (accounts receivable) as of today, per customer — the same balance as Sales'
 * CustomerCredit: opening balance + dues of completed sales − returns credited against them −
 * customer payments. Aged from invoice dates (organization-local sale day): the dues of each
 * sale fall in its bucket, the opening balance in "over 90 days", and credits (returns
 * credited, payments) settle the oldest buckets first.
 *
 * Branch scope: sales, returns and payments of the branches in scope. The opening balance
 * belongs to no branch and is included only when the report covers every branch (no branch
 * filter and a user with access to all branches). Customers with a zero balance are left out.
 */
class CustomerDuesReport implements Report
{
    public function definition(): ReportDefinition
    {
        return new ReportDefinition(
            key: 'customer_dues',
            title: 'Customer dues',
            description: 'What each customer owes today, aged 0–30, 31–60, 61–90 and over 90 days from the invoice dates.',
            group: ReportGroup::Customers,
            permission: 'reports.view',
            params: [ReportParam::branch(), ReportParam::customer()],
            columns: [
                ReportColumn::text('customer', 'Customer'),
                ReportColumn::text('code', 'Code'),
                ReportColumn::text('phone', 'Phone'),
                ReportColumn::money('credit_limit', 'Credit limit'),
                ReportColumn::money('outstanding', 'Outstanding'),
                ...self::bucketColumns(),
                ReportColumn::date('last_payment_on', 'Last payment'),
            ],
            defaultSort: '-outstanding',
        );
    }

    /**
     * @return list<ReportColumn>
     */
    public static function bucketColumns(): array
    {
        return [
            ReportColumn::money('days_0_30', '0–30 days'),
            ReportColumn::money('days_31_60', '31–60 days'),
            ReportColumn::money('days_61_90', '61–90 days'),
            ReportColumn::money('days_over_90', 'Over 90 days'),
        ];
    }

    public function run(ReportContext $context): ReportResult
    {
        $aging = new AgingBuckets($context->today());
        $customer = $context->param('customer_id');
        $org = $context->organizationId;

        $bucket = $aging->bucketSql($context->sql->localDate('s.sold_at'));
        $sales = DB::table('sales as s')->where('s.organization_id', $org)->where('s.status', 'completed')->where('s.due_total', '>', 0)->whereNotNull('s.customer_id');
        $this->scope($sales, $context, 's', $customer);
        $aging->addDebits($sales->groupBy('s.customer_id')->groupByRaw($bucket)->selectRaw("s.customer_id as party, {$bucket} as bucket, SUM(s.due_total) as amount"));

        $returns = DB::table('sale_returns as r')->where('r.organization_id', $org)->where('r.status', 'completed')->where('r.credited_total', '>', 0)->whereNotNull('r.customer_id');
        $this->scope($returns, $context, 'r', $customer);
        $aging->addCredits($returns->groupBy('r.customer_id')->selectRaw('r.customer_id as party, SUM(r.credited_total) as amount'));

        $payments = DB::table('customer_payments as p')->where('p.organization_id', $org);
        $this->scope($payments, $context, 'p', $customer);
        $aging->addCredits((clone $payments)->groupBy('p.customer_id')->selectRaw('p.customer_id as party, SUM(p.amount) as amount'));
        $lastPayments = (clone $payments)->groupBy('p.customer_id')->selectRaw('p.customer_id as party, MAX(p.created_at) as last_at')->pluck('last_at', 'party');

        $withOpening = $context->branchIds === null;
        $customers = DB::table('customers')->where('organization_id', $org)
            ->when($customer, fn (Builder $q, string $id) => $q->where('id', $id))
            ->when(! $withOpening, fn (Builder $q) => $q->whereRaw('1 = 0'))
            ->where('opening_balance', '<>', 0)
            ->get(['id', 'opening_balance']);
        foreach ($customers as $c) {
            $opening = Sql::money($c->opening_balance);
            Decimal::isNegative($opening) ? $aging->addCredit($c->id, Decimal::negate($opening, 2)) : $aging->addDebit($c->id, 'days_over_90', $opening);
        }

        $results = array_filter($aging->results(), fn (array $r) => ! Decimal::isZero($r['outstanding']));
        $info = DB::table('customers')->where('organization_id', $org)->whereIn('id', array_keys($results))->get(['id', 'name', 'code', 'phone', 'credit_limit'])->keyBy('id');

        $rows = [];
        $totals = array_fill_keys(['outstanding', ...Aging::BUCKETS], '0.00');
        foreach ($results as $id => $r) {
            $c = $info[$id] ?? null;
            $last = $lastPayments[$id] ?? null;
            $rows[] = [
                'customer_id' => $id,
                'customer' => $c->name ?? 'Unknown customer',
                'code' => $c->code ?? null,
                'phone' => $c->phone ?? null,
                'credit_limit' => $c === null ? null : Sql::money($c->credit_limit),
                ...$r,
                'last_payment_on' => $last === null ? null : CarbonImmutable::parse((string) $last, 'UTC')->setTimezone($context->timezone)->toDateString(),
            ];
            foreach ($totals as $key => $sum) {
                $totals[$key] = Decimal::add($sum, $r[$key], 2);
            }
        }

        return ReportResult::rows($rows, $totals + ['customers' => count($rows)], meta: ['as_of' => $context->today(), 'includes_opening_balances' => $withOpening]);
    }

    private function scope(Builder $query, ReportContext $context, string $alias, ?string $customerId): void
    {
        $context->scopeBranches($query, $alias.'.branch_id');
        $query->when($customerId, fn (Builder $q, string $id) => $q->where($alias.'.customer_id', $id));
    }
}
