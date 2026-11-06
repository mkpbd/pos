<?php

namespace App\Modules\Reports\Application\Reports;

use App\Modules\Reports\Application\Contracts\Report;
use App\Modules\Reports\Application\ReportContext;
use App\Modules\Reports\Application\ReportResult;
use App\Modules\Reports\Application\Support\Names;
use App\Modules\Reports\Application\Support\Sql;
use App\Modules\Reports\Domain\ReportColumn;
use App\Modules\Reports\Domain\ReportDefinition;
use App\Modules\Reports\Domain\ReportGroup;
use App\Modules\Reports\Domain\ReportParam;
use Carbon\CarbonImmutable;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;

/**
 * Expenses (Expenses module, type expense) by business date (`occurred_on`), per category,
 * branch or month; voided entries excluded. `on_account` = the part booked on account (owed to
 * a supplier, no money moved — SC3 landed cost on stock already sold), flagged separately.
 */
class ExpensesReport implements Report
{
    private const GROUPS = ['category' => 'Category', 'branch' => 'Branch', 'month' => 'Month'];

    public function definition(): ReportDefinition
    {
        return new ReportDefinition(
            key: 'expenses',
            title: 'Expenses',
            description: 'Expenses per category, branch or month (voided entries excluded; expenses booked on account flagged).',
            group: ReportGroup::Finance,
            permission: 'reports.view',
            params: [ReportParam::dateFrom(), ReportParam::dateTo(), ReportParam::branch(), ReportParam::groupBy(self::GROUPS, 'category')],
            columns: [
                ReportColumn::text('group', 'Group'),
                ReportColumn::number('entries', 'Entries'),
                ReportColumn::money('amount', 'Amount'),
                ReportColumn::money('on_account', 'On account'),
                ReportColumn::percent('share', 'Share %'),
            ],
            defaultSort: '-amount',
        );
    }

    public function run(ReportContext $context): ReportResult
    {
        $groupBy = (string) $context->param('group_by', 'category');
        $expression = match ($groupBy) {
            'branch' => 'e.branch_id',
            'month' => $context->sql->month('e.occurred_on'),
            default => 'e.expense_category_id',
        };
        $measures = 'COUNT(*) as entries, SUM(e.amount) as amount, SUM(CASE WHEN '.$context->sql->isTrue('e.on_account').' THEN e.amount ELSE 0 END) as on_account';
        $groups = $this->base($context)->groupByRaw($expression)->selectRaw("{$expression} as group_key, {$measures}")->get();
        $total = $this->base($context)->selectRaw($measures)->first();
        $amount = Sql::money($total?->amount);

        $names = match ($groupBy) {
            'branch' => Names::of('branch', $context->organizationId, $groups->pluck('group_key')),
            'category' => DB::table('expense_categories')->where('organization_id', $context->organizationId)->whereIn('id', $groups->pluck('group_key')->all())->pluck('name', 'id')->all(),
            default => [],
        };
        $rows = $groups->map(fn ($g) => [
            'group_key' => (string) $g->group_key,
            // Months stay "YYYY-MM" so they sort in time order; the readable label is extra.
            'group' => $groupBy === 'month' ? (string) $g->group_key : ($names[$g->group_key] ?? 'Unknown'),
            'group_label' => $groupBy === 'month'
                ? CarbonImmutable::createFromFormat('!Y-m', (string) $g->group_key)->format('M Y')
                : ($names[$g->group_key] ?? 'Unknown'),
            'entries' => (int) $g->entries,
            'amount' => Sql::money($g->amount),
            'on_account' => Sql::money($g->on_account),
            'share' => Sql::percent(Sql::money($g->amount), $amount),
        ])->all();

        return ReportResult::rows($rows, [
            'entries' => (int) ($total->entries ?? 0),
            'amount' => $amount,
            'on_account' => Sql::money($total?->on_account),
            'share' => Sql::percent($amount, $amount),
        ], ['group' => self::GROUPS[$groupBy] ?? 'Category']);
    }

    private function base(ReportContext $context): Builder
    {
        $query = DB::table('expenses as e')
            ->where('e.organization_id', $context->organizationId)
            ->where('e.type', 'expense')
            ->whereNull('e.voided_at')
            ->where('e.occurred_on', '>=', $context->from())
            ->where('e.occurred_on', '<', $context->toExclusive());

        return $context->scopeBranches($query, 'e.branch_id');
    }
}
