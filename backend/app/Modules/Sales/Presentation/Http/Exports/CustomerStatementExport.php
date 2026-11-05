<?php

namespace App\Modules\Sales\Presentation\Http\Exports;

use App\Modules\Shared\Application\Export\ExportColumn;
use Illuminate\Http\Request;

/**
 * GET /customers/{id}/statement?export=xlsx|pdf — the statement with its running balance,
 * framed by opening and closing balance rows.
 */
class CustomerStatementExport extends SalesListExport
{
    private string $customer = '';

    /**
     * @param  array{customer: array<string, mixed>, opening_balance: string, entries: list<array<string, mixed>>, closing_balance: string}  $statement
     * @return list<array<string, mixed>>
     */
    public function rows(array $statement, ?string $from, ?string $to): array
    {
        $this->customer = trim(($statement['customer']['name'] ?? '').' ('.($statement['customer']['code'] ?? '').')');

        return [
            ['date' => $from, 'description' => 'Opening balance', 'balance' => $statement['opening_balance']],
            ...$statement['entries'],
            ['date' => $to, 'description' => 'Closing balance', 'balance' => $statement['closing_balance']],
        ];
    }

    public function name(): string
    {
        return 'customer-statement';
    }

    public function title(): string
    {
        return 'Customer statement — '.$this->customer;
    }

    public function columns(): array
    {
        return [
            ExportColumn::date('date', 'Date'),
            ExportColumn::status('type', 'Type'),
            ExportColumn::text('number', 'Number'),
            ExportColumn::text('description', 'Description'),
            ExportColumn::money('amount', 'Amount'),
            ExportColumn::money('balance', 'Balance'),
        ];
    }

    public function filters(Request $request): array
    {
        return $this->summary($request)->add('Customer', $this->customer)->dates()->all();
    }
}
