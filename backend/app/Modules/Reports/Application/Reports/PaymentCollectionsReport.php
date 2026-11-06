<?php

namespace App\Modules\Reports\Application\Reports;

use App\Modules\Payments\Domain\PaymentMethod;
use App\Modules\Reports\Application\Contracts\Report;
use App\Modules\Reports\Application\ReportContext;
use App\Modules\Reports\Application\ReportResult;
use App\Modules\Reports\Application\Support\Names;
use App\Modules\Reports\Application\Support\Sql;
use App\Modules\Reports\Domain\ReportColumn;
use App\Modules\Reports\Domain\ReportDefinition;
use App\Modules\Reports\Domain\ReportGroup;
use App\Modules\Reports\Domain\ReportParam;
use App\Modules\Shared\Domain\ValueObjects\Decimal;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;

/**
 * Money collected, from the payments ledger (Payments module) by entry time:
 *   collected = Σ entries in of POS sales (`sale`), customer collections (`customer_payment`)
 *               and web orders (`online_order`: bank transfers confirmed and cash on delivery
 *               recorded — COD remittances record one entry per order)
 *   refunded  = Σ entries out of sale cancellations, POS returns and web refunds
 *   net       = collected − refunded
 * Cash in/out of drawers, expenses and other income are not collections. Grouped by day,
 * method, branch, cashier (the user who recorded the entry) or source.
 */
class PaymentCollectionsReport implements Report
{
    public const IN = ['sale', 'customer_payment', 'online_order'];

    public const OUT = ['sale_cancellation', 'sale_return', 'online_order_refund'];

    private const SOURCES = [
        'sale' => 'POS sales', 'customer_payment' => 'Customer collections', 'online_order' => 'Online orders',
        'sale_cancellation' => 'POS sales', 'sale_return' => 'POS sales', 'online_order_refund' => 'Online orders',
    ];

    private const GROUPS = ['day' => 'Date', 'method' => 'Method', 'branch' => 'Branch', 'cashier' => 'Cashier', 'source' => 'Source'];

    public function definition(): ReportDefinition
    {
        $methods = [];
        foreach (PaymentMethod::cases() as $method) {
            $methods[$method->value] = $method->label();
        }

        return new ReportDefinition(
            key: 'payment_collections',
            title: 'Payment collections',
            description: 'Money collected from POS sales, customer payments and web orders (incl. cash on delivery), less refunds, by day, method, branch, cashier or source.',
            group: ReportGroup::Finance,
            permission: 'reports.view',
            params: [
                ReportParam::dateFrom(), ReportParam::dateTo(), ReportParam::branch(), ReportParam::cashier(),
                ReportParam::enum('method', 'Method', $methods), ReportParam::channel(),
                ReportParam::groupBy(self::GROUPS, 'method'),
            ],
            columns: [
                ReportColumn::text('group', 'Group'),
                ReportColumn::number('entries', 'Payments'),
                ReportColumn::money('collected', 'Collected'),
                ReportColumn::money('refunded', 'Refunded'),
                ReportColumn::money('net', 'Net'),
                ReportColumn::percent('share', 'Share of collected %'),
            ],
            defaultSort: '-collected',
        );
    }

    public function run(ReportContext $context): ReportResult
    {
        $groupBy = (string) $context->param('group_by', 'method');
        $expression = match ($groupBy) {
            'day' => $context->sql->localDate('p.created_at'),
            'branch' => 'p.branch_id',
            'cashier' => 'p.created_by',
            'source' => "CASE WHEN p.source_type IN ('online_order', 'online_order_refund') THEN 'online_order' WHEN p.source_type = 'customer_payment' THEN 'customer_payment' ELSE 'sale' END",
            default => 'p.method',
        };
        $measures = "SUM(CASE WHEN p.direction = 'in' THEN 1 ELSE 0 END) as entries, "
            ."SUM(CASE WHEN p.direction = 'in' THEN p.amount ELSE 0 END) as collected, "
            ."SUM(CASE WHEN p.direction = 'out' THEN p.amount ELSE 0 END) as refunded";

        $groups = $this->base($context)->groupByRaw($expression)->selectRaw("{$expression} as group_key, {$measures}")->get();
        $total = $this->base($context)->selectRaw($measures)->first();
        $collected = Sql::money($total?->collected);

        $names = match ($groupBy) {
            'branch' => Names::of('branch', $context->organizationId, $groups->pluck('group_key')),
            'cashier' => Names::of('user', $context->organizationId, $groups->pluck('group_key')),
            default => [],
        };
        $rows = $groups->map(function ($g) use ($groupBy, $names, $collected) {
            $key = $g->group_key === null ? null : (string) $g->group_key;
            $in = Sql::money($g->collected);
            $out = Sql::money($g->refunded);

            return [
                'group_key' => $key,
                'group' => match ($groupBy) {
                    'method' => PaymentMethod::tryFrom((string) $key)?->label() ?? (string) $key,
                    'source' => self::SOURCES[$key] ?? (string) $key,
                    'branch', 'cashier' => $key === null ? 'System' : ($names[$key] ?? 'Unknown'),
                    default => $key,
                },
                'entries' => (int) $g->entries,
                'collected' => $in,
                'refunded' => $out,
                'net' => Decimal::sub($in, $out, 2),
                'share' => Sql::percent($in, $collected),
            ];
        })->all();

        $refunded = Sql::money($total?->refunded);

        return ReportResult::rows($rows, [
            'entries' => (int) ($total->entries ?? 0),
            'collected' => $collected,
            'refunded' => $refunded,
            'net' => Decimal::sub($collected, $refunded, 2),
            'share' => Sql::percent($collected, $collected),
        ], ['group' => self::GROUPS[$groupBy] ?? 'Method']);
    }

    private function base(ReportContext $context): Builder
    {
        $sources = match ($context->channel()) {
            'pos' => ['sale', 'customer_payment', 'sale_cancellation', 'sale_return'],
            'online' => ['online_order', 'online_order_refund'],
            default => [...self::IN, ...self::OUT],
        };
        $query = DB::table('payments as p')
            ->where('p.organization_id', $context->organizationId)
            ->where('p.created_at', '>=', $context->fromInstant())
            ->where('p.created_at', '<', $context->toInstant())
            ->where(fn (Builder $q) => $q
                ->where(fn (Builder $in) => $in->where('p.direction', 'in')->whereIn('p.source_type', array_values(array_intersect($sources, self::IN))))
                ->orWhere(fn (Builder $out) => $out->where('p.direction', 'out')->whereIn('p.source_type', array_values(array_intersect($sources, self::OUT)))));
        $context->scopeBranches($query, 'p.branch_id');

        return $query->when($context->param('cashier_id'), fn (Builder $q, string $id) => $q->where('p.created_by', $id))
            ->when($context->param('method'), fn (Builder $q, string $method) => $q->where('p.method', $method));
    }
}
