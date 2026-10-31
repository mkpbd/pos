<?php

namespace App\Modules\Sales\Application\Actions;

use App\Modules\Inventory\Application\Contracts\StockLedger;
use App\Modules\Inventory\Domain\MovementType;
use App\Modules\Inventory\Domain\StockChange;
use App\Modules\Inventory\Domain\StockReference;
use App\Modules\Sales\Domain\SaleStatus;
use App\Modules\Sales\Infrastructure\Models\Sale;
use App\Modules\Sales\Infrastructure\Models\SaleLine;
use App\Modules\Sales\Infrastructure\Models\SaleLineSerial;
use App\Modules\Sales\Infrastructure\Models\SalePayment;
use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Application\Contracts\TenantUser;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Shared\Domain\ValueObjects\Decimal;
use Illuminate\Support\Facades\DB;

/**
 * Voids a whole sale (e.g. rung up by mistake). The invoice itself is kept: it is marked
 * cancelled, its stock goes back to the exact batches it came from at the cost it left
 * with, every payment gets a negative reversal entry (money handed back), and its serial
 * numbers become sellable again. Partial returns are a separate workflow (Phase 6).
 */
class CancelSale
{
    public function __construct(
        private readonly StockLedger $ledger,
        private readonly AuditTrail $audit,
    ) {}

    public function __invoke(TenantUser $actor, Sale $sale, string $reason): Sale
    {
        return DB::transaction(function () use ($actor, $sale, $reason) {
            /** @var Sale $locked */
            $locked = Sale::query()->whereKey($sale->id)->lockForUpdate()->firstOrFail();
            if ($locked->status !== SaleStatus::Completed) {
                throw new BusinessRuleViolation('SALE_ALREADY_CANCELLED', "{$locked->number} is already cancelled.");
            }

            $lines = $locked->lines()->with('stock')->get();
            $changes = [];
            foreach ($lines as $line) {
                foreach ($line->stock as $allocation) {
                    $changes[] = new StockChange($locked->store_id, $line->variant_id, $allocation->batch_id, MovementType::SaleCancellation, $allocation->quantity, $allocation->unit_cost);
                }
            }
            $this->ledger->post($changes, new StockReference('sale_cancellation', $locked->id, $locked->number));

            $now = now();
            foreach ($locked->payments()->where('kind', 'payment')->get() as $payment) {
                SalePayment::query()->create([
                    'organization_id' => $locked->organization_id,
                    'sale_id' => $locked->id,
                    'branch_id' => $locked->branch_id,
                    'kind' => 'reversal',
                    'method' => $payment->method,
                    'amount' => Decimal::negate($payment->amount, 2),
                    'tendered' => null,
                    'reference' => $payment->reference,
                    'created_by' => $actor->getAuthIdentifier(),
                    'created_at' => $now,
                ]);
            }

            SaleLineSerial::query()
                ->whereIn('sale_line_id', $lines->map(fn (SaleLine $l) => $l->id)->all())
                ->whereNull('released_at')
                ->update(['released_at' => $now]);

            $locked->update([
                'status' => SaleStatus::Cancelled,
                'cancelled_at' => $now,
                'cancelled_by' => $actor->getAuthIdentifier(),
                'cancellation_reason' => $reason,
            ]);

            $this->audit->record('sale.cancelled', $locked, old: ['status' => SaleStatus::Completed->value], new: [
                'status' => SaleStatus::Cancelled->value,
                'number' => $locked->number,
                'total' => $locked->total,
                'paid_total' => $locked->paid_total,
                'reason' => $reason,
            ]);

            return $locked;
        });
    }
}
