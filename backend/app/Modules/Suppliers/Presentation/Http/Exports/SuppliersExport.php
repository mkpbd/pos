<?php

namespace App\Modules\Suppliers\Presentation\Http\Exports;

use App\Modules\Shared\Application\Export\ExportColumn;
use App\Modules\Shared\Infrastructure\Http\Exports\FilterSummary;
use App\Modules\Shared\Infrastructure\Http\Exports\ListExport;
use Illuminate\Http\Request;

/**
 * GET /suppliers?export=xlsx|pdf
 */
class SuppliersExport extends ListExport
{
    public function name(): string
    {
        return 'suppliers';
    }

    public function title(): string
    {
        return 'Suppliers';
    }

    public function columns(): array
    {
        return [
            ExportColumn::text('code', 'Code'),
            ExportColumn::text('name', 'Name'),
            ExportColumn::text('contact_person', 'Contact person'),
            ExportColumn::text('phone', 'Phone'),
            ExportColumn::text('email', 'E-mail'),
            ExportColumn::text('tax_number', 'Tax no.'),
            ExportColumn::number('payment_terms_days', 'Terms (days)'),
            ExportColumn::money('opening_balance', 'Opening balance'),
            ExportColumn::yesNo('is_active', 'Active'),
        ];
    }

    public function filters(Request $request): array
    {
        return FilterSummary::of($request)
            ->search()
            ->boolean('is_active', 'Active')
            ->flag('archived', 'Archived only')
            ->all();
    }
}
