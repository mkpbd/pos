<?php

namespace App\Modules\Reports\Application\Reports;

use App\Modules\Reports\Application\Contracts\Report;
use App\Modules\Reports\Application\ReportContext;
use App\Modules\Reports\Application\ReportResult;
use App\Modules\Reports\Application\Support\Sql;
use App\Modules\Reports\Domain\ColumnType;
use App\Modules\Reports\Domain\ReportColumn;
use App\Modules\Reports\Domain\ReportDefinition;
use App\Modules\Reports\Domain\ReportGroup;
use App\Modules\Reports\Domain\ReportParam;
use App\Modules\Shared\Domain\ValueObjects\Decimal;
use Carbon\CarbonImmutable;
use Illuminate\Database\Query\Builder;

/**
 * VAT1: the monthly VAT summary used to fill the Mushak-9.1 return (a working summary, not
 * the return form). The month is a calendar month in the organization's timezone; every
 * figure is a sum of the registers' lines for that month, so it equals their totals:
 *
 *   Output (Mushak-6.2, all channels)  per VAT rate: sales, less returns
 *   = Total output VAT
 *   Input (Mushak-6.1)                 per VAT rate: purchases, less purchase returns
 *   = Total input VAT
 *   Net VAT payable = output − input; a negative result is the VAT credit carried forward
 *   (shown as a positive amount on that line).
 *
 * Rows are statement lines in order (`key`, `section`, `kind` line|total, `label`, `vat_rate`,
 * `value`, `sd`, `vat`); `meta.summary` carries output_vat, input_vat, net_vat (signed),
 * payable and carried_forward. Landed-cost charges are not included. SD is always 0.
 */
class VatSummaryReport implements Report
{
    public function __construct(
        private readonly SalesRegisterReport $sales,
        private readonly PurchaseRegisterReport $purchases,
    ) {}

    public function definition(): ReportDefinition
    {
        return new ReportDefinition(
            key: 'mushak_9_1',
            title: 'Monthly VAT summary (for Mushak-9.1)',
            description: 'Output VAT on sales and input VAT on purchases per rate for one month, less returns, and the net VAT payable or carried forward — a working summary to fill the Mushak-9.1 return, not the return form. Equals the Mushak-6.2 and 6.1 registers; landed-cost charges are not included.',
            group: ReportGroup::Finance,
            permission: 'reports.financial',
            params: [ReportParam::month(), ReportParam::branch()],
            columns: [
                ReportColumn::text('label', 'Line', sortable: false),
                new ReportColumn('vat_rate', 'VAT rate %', ColumnType::Percent, sortable: false),
                new ReportColumn('value', 'Value (excl. VAT)', ColumnType::Money, sortable: false),
                new ReportColumn('sd', 'Supplementary duty', ColumnType::Money, sortable: false),
                new ReportColumn('vat', 'VAT', ColumnType::Money, sortable: false),
            ],
            defaultSort: null,
            totals: false,
            paginated: false,
        );
    }

    public function run(ReportContext $context): ReportResult
    {
        $month = CarbonImmutable::createFromFormat('!Y-m', (string) $context->param('month'));
        $period = $context->with(['date_from' => $month->toDateString(), 'date_to' => $month->endOfMonth()->toDateString(), 'channel' => 'all']);

        $rows = [];
        $output = $this->section($rows, 'output', $this->sales->lines($period), ['Sale' => 'Sales', 'Return' => 'Less sales returns'], 'Total output VAT');
        $input = $this->section($rows, 'input', $this->purchases->lines($period), ['Purchase' => 'Purchases', 'Return' => 'Less purchase returns'], 'Total input VAT');

        $net = Decimal::sub($output['vat'], $input['vat'], 2);
        $payable = Decimal::isNegative($net) ? '0.00' : $net;
        $carried = Decimal::isNegative($net) ? Decimal::negate($net, 2) : '0.00';
        $rows[] = Decimal::isNegative($net)
            ? self::line('carried_forward', 'net', 'total', 'VAT credit carried forward', null, null, $carried)
            : self::line('net_payable', 'net', 'total', 'Net VAT payable', null, null, $payable);

        return ReportResult::rows($rows, null, meta: [
            'month' => $month->format('Y-m'),
            'period' => ['date_from' => $period->from(), 'date_to' => $period->to()],
            'summary' => [
                'output_value' => $output['value'],
                'output_vat' => $output['vat'],
                'input_value' => $input['value'],
                'input_vat' => $input['vat'],
                'net_vat' => $net,
                'payable' => $payable,
                'carried_forward' => $carried,
            ],
        ]);
    }

    /**
     * Appends one section's lines (per rate: documents, then returns) and its total line.
     *
     * @param  list<array<string, mixed>>  $rows
     * @param  array<string, string>  $labels  register type => line label
     * @return array{value: string, vat: string}
     */
    private function section(array &$rows, string $section, Builder $lines, array $labels, string $totalLabel): array
    {
        $groups = $lines->groupBy('x.vat_rate', 'x.type')
            ->selectRaw('x.vat_rate as vat_rate, x.type as type, SUM(x.value) as value, SUM(x.vat) as vat')
            ->get()->all();
        $order = array_flip(array_keys($labels));
        usort($groups, fn ($a, $b) => Decimal::compare(Sql::plain($a->vat_rate), Sql::plain($b->vat_rate)) ?: $order[$a->type] <=> $order[$b->type]);

        $total = ['value' => '0.00', 'vat' => '0.00'];
        foreach ($groups as $g) {
            $rate = Decimal::round(Sql::plain($g->vat_rate), 2);
            $value = Sql::money($g->value);
            $vat = Sql::money($g->vat);
            $rows[] = self::line($section.':'.$g->type.':'.$rate, $section, 'line', $labels[$g->type].' at '.self::percent($rate), $rate, $value, $vat);
            $total = ['value' => Decimal::add($total['value'], $value, 2), 'vat' => Decimal::add($total['vat'], $vat, 2)];
        }
        $rows[] = self::line($section.'_total', $section, 'total', $totalLabel, null, $total['value'], $total['vat']);

        return $total;
    }

    /**
     * @return array<string, mixed>
     */
    private static function line(string $key, string $section, string $kind, string $label, ?string $rate, ?string $value, string $vat): array
    {
        return ['key' => $key, 'section' => $section, 'kind' => $kind, 'label' => $label, 'vat_rate' => $rate, 'value' => $value, 'sd' => '0.00', 'vat' => $vat];
    }

    private static function percent(string $rate): string
    {
        return (str_contains($rate, '.') ? rtrim(rtrim($rate, '0'), '.') : $rate).'%';
    }
}
