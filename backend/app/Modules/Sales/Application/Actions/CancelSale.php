<?php

namespace App\Modules\Sales\Application\Actions;

use App\Modules\Inventory\Application\Contracts\StockLedger;
use App\Modules\Inventory\Domain\MovementType;
use App\Modules\Inventory\Domain\StockChange;
use App\Modules\Inventory\Domain\StockReference;
use App\Modules\Payments\Application\Contracts\PaymentLedger;
use App\Modules\Payments\Domain\LedgerEntry;
use App\Modules\Payments\Domain\PaymentDirection;
use App\Modules\Payments\Domain\PaymentMethod as LedgerMethod;
use App\Modules\Payments\Domain\PaymentSource;
use App\Modules\Sales\Application\Contracts\LoyaltyProgram;
use App\Modules\Sales\Domain\PaymentMethod;
use App\Modules\Sales\Domain\ReturnStatus;
use App\Modules\Sales\Domain\SaleStatus;
use App\Modules\Sales\Infrastructure\Models\Sale;
use App\Modules\Sales\Infrastructure\Models\SaleLine;
use App\Modules\Sales\Infrastructure\Models\SaleLineSerial;
use App\Modules\Sales\Infrastructure\Models\SalePayment;
use App\Modules\Sales\Infrastructure\Models\SaleReturn;
use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Application\Contracts\TenantUser;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Shared\Domain\ValueObjects\Decimal;
use Illuminate\Support\Facades\DB;

/**
 * Voids a whole sale (e.g. rung up by mistake). The invoice itself is kept: it is marked
 * cancelled, its stock goes back to the exact batches it came from at the cost it left
 * with, every payment gets a negative reversal entry (money handed back through the
 * payments ledger: cash comes out of the canceller's drawer), loyalty points are reversed,
 * and its serial numbers become sellable again. A sale with returns cannot be cancelled;
 * returns are the way to take back part of a sale.
 */
class CancelSale
{
    public function __construct(
        private readonly StockLedger $ledger,
        private readonly PaymentLedger $payments,
        private readonly LoyaltyProgram $loyalty,
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
            $returns = SaleReturn::query()->where('sale_id', $locked->id)->whereIn('status', [ReturnStatus::Pending, ReturnStatus::Completed])->pluck('number');
            if ($returns->isNotEmpty()) {
                throw new BusinessRuleViolation('SALE_HAS_RETURNS', "{$locked->number} has returns ({$returns->implode(', ')}); it can no longer be cancelled.", ['returns' => $returns->all()]);
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
            $paid = $locked->payments()->where('kind', 'payment')->get();
            foreach ($paid as $payment) {
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

            $this->payments->record($actor, $locked->branch_id, $paid
                ->filter(fn (SalePayment $p) => $p->method !== PaymentMethod::LoyaltyPoints)
                ->map(fn (SalePayment $p) => new LedgerEntry(PaymentDirection::Out, LedgerMethod::from($p->method->value), $p->amount, $locked->customer_id, $p->reference))
                ->values()->all(), new PaymentSource('sale_cancellation', $locked->id, $locked->number));
            if ($locked->customer_id !== null) {
                $this->loyalty->reverseSale($locked->customer_id, $locked->id, $locked->number);
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
