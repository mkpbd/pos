<?php

namespace App\Modules\Payments\Presentation\Http\Exports;

use App\Modules\Payments\Infrastructure\Models\CashRegister;
use App\Modules\Shared\Application\Export\ExportColumn;
use Illuminate\Http\Request;

/**
 * GET /register-sessions?export=xlsx|pdf — cash register sessions with float, counts and variance.
 */
class RegisterSessionsExport extends PaymentsListExport
{
    public function name(): string
    {
        return 'register-sessions';
    }

    public function title(): string
    {
        return 'Register sessions';
    }

    public function columns(): array
    {
        return [
            ExportColumn::text('number', 'Session'),
            ExportColumn::text('register.name', 'Register'),
            ExportColumn::text('branch.name', 'Branch'),
            ExportColumn::text('opened_by.name', 'Opened by'),
            ExportColumn::dateTime('opened_at', 'Opened'),
            ExportColumn::dateTime('closed_at', 'Closed'),
            ExportColumn::money('opening_float', 'Opening float'),
            ExportColumn::money('expected_cash', 'Expected cash'),
            ExportColumn::money('counted_cash', 'Counted cash'),
            ExportColumn::money('variance', 'Variance'),
            ExportColumn::status('status', 'Status'),
        ];
    }

    public function filters(Request $request): array
    {
        return $this->summary($request)
            ->lookup('cash_register_id', 'Register', fn (string $id) => CashRegister::query()->whereKey($id)->value('name'))
            ->lookup('opened_by', 'Opened by', fn (string $id) => $this->userName($id))
            ->value('status', 'Status')
            ->all();
    }
}
