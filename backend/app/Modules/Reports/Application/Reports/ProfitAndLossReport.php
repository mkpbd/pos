<?php

namespace App\Modules\Reports\Application\Reports;

use App\Modules\Reports\Application\Contracts\Report;
use App\Modules\Reports\Application\ReportContext;
use App\Modules\Reports\Application\ReportResult;
use App\Modules\Reports\Application\Support\SalesFacts;
use App\Modules\Reports\Application\Support\Sql;
use App\Modules\Reports\Domain\ColumnType;
use App\Modules\Reports\Domain\ReportColumn;
use App\Modules\Reports\Domain\ReportDefinition;
use App\Modules\Reports\Domain\ReportGroup;
use App\Modules\Reports\Domain\ReportParam;
use App\Modules\Shared\Domain\ValueObjects\Decimal;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

/**
 * Profit and loss statement for the period, compared with the previous period of the same
 * length (immediately before `date_from`). Rows are statement lines in order; amounts are
 * signed so that each subtotal is the sum of the lines above it in its section:
 *
 *   Gross sales                      + (SalesFacts: POS and delivered web orders)
 *   Discounts                        −
 *   Returns                          −
 *   = Net sales                      (excluding tax)
 *   Delivery income                  + (web orders' delivery and COD fees, net of refunds)
 *   = Total revenue
 *   Cost of goods sold               − (stock ledger cost of goods out, minus restocked returns;
 *                                       landed costs included through weighted average cost)
 *   = Gross profit
 *   Operating expenses, per category − (Expenses module, type expense, voided excluded, by
 *                                       occurred_on; includes on-account expenses such as
 *                                       landed cost on stock already sold, SC3)
 *   = Total operating expenses
 *   Other income, per category       + (Expenses module, type income)
 *   = Total other income
 *   = Net profit                     = gross profit − operating expenses + other income
 *
 * Tax is not revenue (see the tax report). Needs `reports.financial`.
 */
class ProfitAndLossReport implements Report
{
    public function __construct(private readonly SalesFacts $facts) {}

    public function definition(): ReportDefinition
    {
        return new ReportDefinition(
            key: 'profit_and_loss',
            title: 'Profit and loss',
            description: 'Revenue, cost of goods sold, gross profit, operating expenses by category, other income and net profit, compared with the previous period.',
            group: ReportGroup::Finance,
            permission: 'reports.financial',
            params: [ReportParam::dateFrom(), ReportParam::dateTo(), ReportParam::branch()],
            columns: [
                ReportColumn::text('label', 'Line', sortable: false),
                new ReportColumn('amount', 'This period', ColumnType::Money, sortable: false),
                new ReportColumn('previous_amount', 'Previous period', ColumnType::Money, sortable: false),
                new ReportColumn('change', 'Change', ColumnType::Money, sortable: false),
                new ReportColumn('change_pct', 'Change %', ColumnType::Percent, sortable: false),
            ],
            defaultSort: null,
            totals: false,
            paginated: false,
        );
    }

    /**
     * @return array{date_from: string, date_to: string}
     */
    public static function previousPeriod(string $from, string $to): array
    {
        $days = (int) CarbonImmutable::parse($from)->diffInDays(CarbonImmutable::parse($to)) + 1;
        $previousTo = CarbonImmutable::parse($from)->subDay();

        return ['date_from' => $previousTo->subDays($days - 1)->toDateString(), 'date_to' => $previousTo->toDateString()];
    }

    public function run(ReportContext $context): ReportResult
    {
        $previous = self::previousPeriod($context->from(), $context->to());
        $current = $this->statement($context, $context->from(), $context->to());
        $before = $this->statement($context, $previous['date_from'], $previous['date_to']);

        // Lines of both periods, in the current period's order (categories only in the previous one appended).
        $order = array_keys($current);
        foreach (array_keys($before) as $key) {
            if (! in_array($key, $order, true)) {
                $order[] = $key;
            }
        }
        $order = self::ordered($order, $current + $before);

        $rows = [];
        foreach ($order as $key) {
            $line = $current[$key] ?? $before[$key];
            $amount = $current[$key]['amount'] ?? '0.00';
            $previousAmount = $before[$key]['amount'] ?? '0.00';
            $change = Decimal::sub($amount, $previousAmount, 2);
            $rows[] = [
                'key' => $key,
                'label' => $line['label'],
                'section' => $line['section'],
                'kind' => $line['kind'],
                'level' => $line['kind'] === 'line' && str_contains($key, ':') ? 1 : 0,
                'amount' => $amount,
                'previous_amount' => $previousAmount,
                'change' => $change,
                'change_pct' => Decimal::isZero($previousAmount) ? null : Sql::percent($change, ltrim($previousAmount, '-')),
            ];
        }

        return ReportResult::rows($rows, null, meta: [
            'previous_period' => $previous,
            'summary' => [
                'net_sales' => $current['net_sales']['amount'],
                'gross_profit' => $current['gross_profit']['amount'],
                'net_profit' => $current['net_profit']['amount'],
                'previous_net_profit' => $before['net_profit']['amount'],
            ],
        ]);
    }

    /**
     * Keeps category lines inside their section, by name, before the section's subtotal.
     *
     * @param  list<string>  $keys
     * @param  array<string, array<string, mixed>>  $lines
     * @return list<string>
     */
    private static function ordered(array $keys, array $lines): array
    {
        $sections = ['revenue' => [], 'cost' => [], 'expenses' => [], 'other_income' => [], 'result' => []];
        foreach ($keys as $key) {
            $sections[$lines[$key]['section']][] = $key;
        }
        $place = function (array $section, string $subtotal) use ($lines): array {
            $categories = array_values(array_filter($section, fn ($k) => $k !== $subtotal));
            usort($categories, fn (string $a, string $b) => strcmp(mb_strtolower($lines[$a]['label']), mb_strtolower($lines[$b]['label'])) ?: strcmp($a, $b));

            return [...$categories, $subtotal];
        };

        return [
            ...$sections['revenue'],
            ...$sections['cost'],
            ...$place($sections['expenses'], 'total_expenses'),
            ...$place($sections['other_income'], 'total_other_income'),
            ...$sections['result'],
        ];
    }

    /**
     * @return array<string, array{label: string, section: string, kind: string, amount: string}>
     */
    private function statement(ReportContext $context, string $from, string $to): array
    {
        $sales = $this->facts->totals($context, $from, $to);
        $negate = fn (string $v) => Decimal::negate($v, 2);
        $line = fn (string $label, string $section, string $amount, string $kind = 'line') => ['label' => $label, 'section' => $section, 'kind' => $kind, 'amount' => $amount];

        $totalRevenue = Decimal::add($sales['net_sales'], $sales['delivery_income'], 2);
        $grossProfit = Decimal::sub($totalRevenue, $sales['cost'], 2);
        $lines = [
            'gross_sales' => $line('Gross sales', 'revenue', $sales['gross']),
            'discounts' => $line('Discounts', 'revenue', $negate($sales['discounts'])),
            'returns' => $line('Returns', 'revenue', $negate($sales['returns'])),
            'net_sales' => $line('Net sales', 'revenue', $sales['net_sales'], 'subtotal'),
            'delivery_income' => $line('Delivery income', 'revenue', $sales['delivery_income']),
            'total_revenue' => $line('Total revenue', 'revenue', $totalRevenue, 'subtotal'),
            'cost_of_goods_sold' => $line('Cost of goods sold', 'cost', $negate($sales['cost'])),
            'gross_profit' => $line('Gross profit', 'cost', $grossProfit, 'subtotal'),
        ];

        $expenses = '0.00';
        foreach ($this->entries($context, 'expense', $from, $to) as $entry) {
            $lines['expense:'.$entry->category_id] = $line((string) $entry->name, 'expenses', $negate(Sql::money($entry->amount)));
            $expenses = Decimal::add($expenses, Sql::money($entry->amount), 2);
        }
        $lines['total_expenses'] = $line('Total operating expenses', 'expenses', $negate($expenses), 'subtotal');

        $income = '0.00';
        foreach ($this->entries($context, 'income', $from, $to) as $entry) {
            $lines['income:'.$entry->category_id] = $line((string) $entry->name, 'other_income', Sql::money($entry->amount));
            $income = Decimal::add($income, Sql::money($entry->amount), 2);
        }
        $lines['total_other_income'] = $line('Total other income', 'other_income', $income, 'subtotal');
        $lines['net_profit'] = $line('Net profit', 'result', Decimal::add(Decimal::sub($grossProfit, $expenses, 2), $income, 2), 'total');

        return $lines;
    }

    /**
     * Expense or income totals per category over [from, to] (business dates), voided excluded.
     *
     * @return list<object>
     */
    private function entries(ReportContext $context, string $type, string $from, string $to): array
    {
        $query = DB::table('expenses as e')
            ->join('expense_categories as c', 'c.id', '=', 'e.expense_category_id')
            ->where('e.organization_id', $context->organizationId)
            ->where('e.type', $type)
            ->whereNull('e.voided_at')
            ->where('e.occurred_on', '>=', $from)
            ->where('e.occurred_on', '<', CarbonImmutable::parse($to)->addDay()->toDateString());
        $context->scopeBranches($query, 'e.branch_id');

        return $query->groupBy('e.expense_category_id', 'c.name')
            ->orderBy('c.name')
            ->get(['e.expense_category_id as category_id', 'c.name', DB::raw('SUM(e.amount) as amount')])
            ->all();
    }
}
