<?php

namespace App\Modules\Payments\Presentation\Http\Exports;

use App\Modules\Payments\Infrastructure\Models\RegisterSession;
use App\Modules\Shared\Application\Export\ExportColumn;
use Illuminate\Http\Request;

/**
 * GET /payments?export=xlsx|pdf — the payments ledger (every amount in and out).
 */
class PaymentsLedgerExport extends PaymentsListExport
{
    public function name(): string
    {
        return 'payments';
    }

    public function title(): string
    {
        return 'Payments ledger';
    }

    public function columns(): array
    {
        return [
            ExportColumn::dateTime('created_at', 'Date'),
            ExportColumn::status('direction', 'Direction'),
            ExportColumn::text('method_label', 'Method'),
            ExportColumn::text('source_label', 'Source'),
            ExportColumn::text('source_number', 'Document'),
            ExportColumn::text('branch_id', 'Branch', fn (array $r) => $this->branchName($r['branch_id'] ?? null)),
            ExportColumn::text('reference', 'Reference'),
            ExportColumn::text('session.number', 'Session'),
            ExportColumn::money('amount', 'Amount'),
            ExportColumn::text('created_by.name', 'By'),
        ];
    }

    public function filters(Request $request): array
    {
        return $this->summary($request)
            ->value('direction', 'Direction')
            ->value('method', 'Method')
            ->value('source_type', 'Source')
            ->lookup('cash_register_session_id', 'Session', fn (string $id) => RegisterSession::query()->whereKey($id)->value('number'))
            ->dates()
            ->all();
    }
}
