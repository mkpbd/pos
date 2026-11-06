<?php

namespace App\Modules\Reports\Application\Reports;

use App\Modules\Reports\Application\Contracts\Report;
use App\Modules\Reports\Application\Support\SalesFacts;
use App\Modules\Reports\Application\Support\Sql;
use App\Modules\Reports\Domain\ReportColumn;
use App\Modules\Shared\Domain\ValueObjects\Decimal;

/**
 * Shared columns and figures of the sales reports (definitions of the amounts: SalesFacts).
 *
 *   gross_sales − discounts − returns = net_sales (excluding tax)
 *   gross_profit = net_sales − cost; margin = gross_profit ÷ net_sales × 100
 *   average_ticket = net_sales ÷ orders
 */
abstract class SalesReport implements Report
{
    public function __construct(protected readonly SalesFacts $facts) {}

    /**
     * @param  list<string>  $only  figure keys to include, in order
     * @return list<ReportColumn>
     */
    protected static function figureColumns(array $only): array
    {
        $all = [
            'orders' => ReportColumn::number('orders', 'Orders'),
            'quantity' => ReportColumn::quantity('quantity', 'Quantity'),
            'gross_sales' => ReportColumn::money('gross_sales', 'Gross sales'),
            'discounts' => ReportColumn::money('discounts', 'Discounts'),
            'returns' => ReportColumn::money('returns', 'Returns'),
            'net_sales' => ReportColumn::money('net_sales', 'Net sales'),
            'tax' => ReportColumn::money('tax', 'Tax'),
            'delivery_income' => ReportColumn::money('delivery_income', 'Delivery income'),
            'average_ticket' => ReportColumn::money('average_ticket', 'Average ticket'),
            'cost' => ReportColumn::money('cost', 'Cost of goods', costSensitive: true),
            'gross_profit' => ReportColumn::money('gross_profit', 'Gross profit', costSensitive: true),
            'margin' => ReportColumn::percent('margin', 'Margin %', costSensitive: true),
        ];

        return array_map(fn (string $key) => $all[$key], $only);
    }

    /**
     * The report figures of one aggregated SalesFacts row.
     *
     * @param  array<string, mixed>  $agg
     * @param  list<string>  $only
     * @return array<string, mixed>
     */
    protected static function figures(array $agg, array $only): array
    {
        $all = [
            'orders' => (int) $agg['orders'],
            'quantity' => $agg['quantity'],
            'gross_sales' => $agg['gross'],
            'discounts' => $agg['discounts'],
            'returns' => $agg['returns'],
            'net_sales' => $agg['net_sales'],
            'tax' => $agg['tax'],
            'delivery_income' => $agg['delivery_income'],
            'average_ticket' => (int) $agg['orders'] > 0 ? Decimal::div($agg['net_sales'], (string) $agg['orders'], 2) : null,
            'cost' => $agg['cost'],
            'gross_profit' => $agg['gross_profit'],
            'margin' => Sql::percent($agg['gross_profit'], $agg['net_sales']),
        ];

        $figures = [];
        foreach ($only as $key) {
            $figures[$key] = $all[$key];
        }

        return $figures;
    }

    /**
     * Figures of a group with nothing in it.
     *
     * @return array<string, mixed>
     */
    protected static function emptyAggregate(): array
    {
        return ['orders' => 0, 'quantity' => '0.000', 'gross' => '0.00', 'discounts' => '0.00', 'returns' => '0.00', 'net_sales' => '0.00',
            'tax' => '0.00', 'delivery_income' => '0.00', 'cost' => '0.00', 'gross_profit' => '0.00'];
    }
}
