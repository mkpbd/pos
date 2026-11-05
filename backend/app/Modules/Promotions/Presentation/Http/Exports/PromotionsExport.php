<?php

namespace App\Modules\Promotions\Presentation\Http\Exports;

use App\Modules\Shared\Application\Export\ExportColumn;
use App\Modules\Shared\Infrastructure\Http\Exports\FilterSummary;
use App\Modules\Shared\Infrastructure\Http\Exports\ListExport;
use Illuminate\Http\Request;

/**
 * GET /promotions?export=xlsx|pdf
 */
class PromotionsExport extends ListExport
{
    public function name(): string
    {
        return 'promotions';
    }

    public function title(): string
    {
        return 'Promotions';
    }

    public function columns(): array
    {
        return [
            ExportColumn::text('name', 'Promotion'),
            ExportColumn::status('type', 'Type'),
            ExportColumn::number('value', 'Value'),
            ExportColumn::status('scope', 'Applies to'),
            ExportColumn::status('trigger', 'Trigger'),
            ExportColumn::dateTime('starts_at', 'Starts'),
            ExportColumn::dateTime('ends_at', 'Ends'),
            ExportColumn::status('state', 'Status'),
            ExportColumn::number('coupon_count', 'Coupons'),
            ExportColumn::number('redemption_count', 'Redemptions'),
            ExportColumn::money('discount_total', 'Discount given'),
        ];
    }

    public function filters(Request $request): array
    {
        return FilterSummary::of($request)->search()->value('status', 'Status')->value('trigger', 'Trigger')->all();
    }
}
