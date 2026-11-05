<?php

namespace App\Modules\Customers\Presentation\Http\Exports;

use App\Modules\Customers\Infrastructure\Models\CustomerGroup;
use App\Modules\Shared\Application\Export\ExportColumn;
use App\Modules\Shared\Infrastructure\Http\Exports\FilterSummary;
use App\Modules\Shared\Infrastructure\Http\Exports\ListExport;
use Illuminate\Http\Request;

/**
 * GET /customers?export=xlsx|pdf
 */
class CustomersExport extends ListExport
{
    public function name(): string
    {
        return 'customers';
    }

    public function title(): string
    {
        return 'Customers';
    }

    public function columns(): array
    {
        return [
            ExportColumn::text('code', 'Code'),
            ExportColumn::text('name', 'Name'),
            ExportColumn::text('phone', 'Phone'),
            ExportColumn::text('email', 'E-mail'),
            ExportColumn::text('group.name', 'Group'),
            ExportColumn::money('credit_limit', 'Credit limit'),
            ExportColumn::money('opening_balance', 'Opening balance'),
            ExportColumn::yesNo('is_active', 'Active'),
            ExportColumn::date('created_at', 'Created'),
        ];
    }

    public function filters(Request $request): array
    {
        return FilterSummary::of($request)
            ->search()
            ->lookup('customer_group_id', 'Group', fn (string $id) => CustomerGroup::query()->whereKey($id)->value('name'))
            ->boolean('is_active', 'Active')
            ->flag('archived', 'Archived only')
            ->all();
    }
}
