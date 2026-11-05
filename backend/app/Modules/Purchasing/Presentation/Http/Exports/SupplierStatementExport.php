<?php

namespace App\Modules\Purchasing\Presentation\Http\Exports;

use App\Modules\Shared\Application\Export\ExportColumn;
use App\Modules\Shared\Infrastructure\Http\Exports\FilterSummary;
use Illuminate\Http\Request;

/**
 * GET /purchasing/suppliers/{id}/statement?export=xlsx|pdf — the statement with its running
 * balance, framed by opening and closing balance rows.
 */
class SupplierStatementExport extends PurchasingListExport
{
    private string $supplier = '';

    /**
     * @param  array{supplier: array<string, mixed>, opening_balance: string, entries: list<array<string, mixed>>, closing_balance: string}  $statement
     * @return list<array<string, mixed>>
     */
    public function rows(array $statement, ?string $from, ?string $to): array
    {
        $this->supplier = trim(($statement['supplier']['name'] ?? '').' ('.($statement['supplier']['code'] ?? '').')');

        return [
            ['date' => $from, 'reference' => 'Opening balance', 'balance' => $statement['opening_balance']],
            ...$statement['entries'],
            ['date' => $to, 'reference' => 'Closing balance', 'balance' => $statement['closing_balance']],
        ];
    }

    public function name(): string
    {
        return 'supplier-statement';
    }

    public function title(): string
    {
        return 'Supplier statement — '.$this->supplier;
    }

    public function columns(): array
    {
        return [
            ExportColumn::date('date', 'Date'),
            ExportColumn::status('type', 'Type'),
            ExportColumn::text('number', 'Number'),
            ExportColumn::text('reference', 'Reference'),
            ExportColumn::money('amount', 'Amount'),
            ExportColumn::money('balance', 'Balance'),
        ];
    }

    public function filters(Request $request): array
    {
        return FilterSummary::of($request)->add('Supplier', $this->supplier)->dates()->all();
    }
}
