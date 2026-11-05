<?php

namespace App\Modules\Promotions\Presentation\Http\Exports;

use App\Modules\Shared\Application\Export\ExportColumn;
use App\Modules\Shared\Infrastructure\Export\ExportValues;
use App\Modules\Shared\Infrastructure\Http\Exports\FilterSummary;
use App\Modules\Shared\Infrastructure\Http\Exports\ListExport;
use Illuminate\Http\Request;

/**
 * GET /promotions/{id}/report?export=xlsx|pdf — redemptions and discount per day, a total
 * row, and the report's headline figures in the filter line.
 */
class PromotionReportExport extends ListExport
{
    private string $promotion = '';

    /** @var array<string, mixed> */
    private array $report = [];

    /**
     * @param  array<string, mixed>  $report  PromotionReport::for()
     * @return list<array<string, mixed>>
     */
    public function rows(string $promotionName, array $report): array
    {
        $this->promotion = $promotionName;
        $this->report = $report;

        return [
            ...$report['by_day'],
            ['date' => 'Total', 'redemptions' => $report['redemptions'], 'discount' => $report['discount_total']],
        ];
    }

    public function name(): string
    {
        return 'promotion-report';
    }

    public function title(): string
    {
        return 'Promotion report — '.$this->promotion;
    }

    public function columns(): array
    {
        return [
            ExportColumn::date('date', 'Date'),
            ExportColumn::number('redemptions', 'Redemptions'),
            ExportColumn::money('discount', 'Discount'),
        ];
    }

    public function filters(Request $request): array
    {
        $summary = FilterSummary::of($request)->dates('date_from', 'date_to');
        if ($this->report !== []) {
            $summary->add('Orders', (string) $this->report['orders'])
                ->add('Cancelled orders', (string) $this->report['cancelled_orders'])
                ->add('Order revenue', ExportValues::grouped((string) $this->report['order_revenue'], 2))
                ->add('Average discount', ExportValues::grouped((string) $this->report['average_discount'], 2));
        }

        return $summary->all();
    }
}
