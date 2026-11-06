<?php

namespace App\Modules\Purchasing\Application\Actions;

use App\Modules\Expenses\Application\Contracts\ExpenseRecorder;
use App\Modules\Inventory\Application\Contracts\StockValuation;
use App\Modules\Inventory\Domain\StockReference;
use App\Modules\Inventory\Domain\StockRevaluation;
use App\Modules\Payments\Domain\PaymentMethod;
use App\Modules\Purchasing\Application\Services\LandedCostCalculator;
use App\Modules\Purchasing\Application\Services\PurchasingContext;
use App\Modules\Purchasing\Domain\LandedCost\LandedCostVoucherStatus;
use App\Modules\Purchasing\Infrastructure\Models\GoodsReceipt;
use App\Modules\Purchasing\Infrastructure\Models\LandedCostAllocation;
use App\Modules\Purchasing\Infrastructure\Models\LandedCostVoucher;
use App\Modules\Purchasing\Infrastructure\Models\LandedCostVoucherCharge;
use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Application\Contracts\TenantUser;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Shared\Domain\ValueObjects\Decimal;
use Illuminate\Support\Facades\DB;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

/**
 * SC3: posts a landed cost voucher, once, in one transaction:
 *  1. lock the voucher row; anything but a draft → INVALID_STATUS_CHANGE (a retry with the
 *     same Idempotency-Key replays the first answer instead);
 *  2. lock the affected stock levels and compute the allocation (LandedCostCalculator);
 *  3. the on-hand shares become value-only `landed_cost` movements per stock level
 *     (StockValuation::revalue — the weighted average cost rises, quantities do not move);
 *  4. the consumed shares (stock already sold, used or returned) become one expense
 *     "Landed cost on sold stock" dated the voucher date, booked on the charge supplier's
 *     account (ExpenseRecorder, on_account — no payment is recorded);
 *  5. append-only allocation rows per receipt line, the totals and the posted status.
 * The voucher total (with tax) is then owed to the charge supplier (SupplierAccount).
 */
class PostLandedCostVoucher
{
    public const EXPENSE_CATEGORY = 'Landed cost on sold stock';

    public function __construct(
        private readonly PurchasingContext $context,
        private readonly LandedCostCalculator $calculator,
        private readonly StockValuation $valuation,
        private readonly ExpenseRecorder $expenses,
        private readonly AuditTrail $audit,
    ) {}

    public function __invoke(TenantUser $actor, LandedCostVoucher $voucher): LandedCostVoucher
    {
        if (! $actor->canAccessBranch($voucher->branch_id)) {
            throw new NotFoundHttpException;
        }
        $organizationId = $this->context->organizationId();

        return DB::transaction(function () use ($actor, $voucher, $organizationId) {
            /** @var LandedCostVoucher $locked */
            $locked = LandedCostVoucher::query()->whereKey($voucher->id)->lockForUpdate()->firstOrFail();
            if ($locked->status !== LandedCostVoucherStatus::Draft) {
                throw new BusinessRuleViolation('INVALID_STATUS_CHANGE', "Landed cost voucher {$locked->number} is already {$locked->status->value}.", [
                    'status' => $locked->status->value,
                ]);
            }
            $supplier = $this->context->requireActiveSupplier($locked->charge_supplier_id, 'charge_supplier_id');

            $charges = $locked->charges()->get();
            $receiptIds = $locked->receipts()->pluck('goods_receipt_id')->all();
            $receipts = GoodsReceipt::query()->whereKey($receiptIds)->get()->keyBy('id');
            $receipts = collect($receiptIds)->map(fn (string $id) => $receipts[$id])->values();
            if ($charges->isEmpty() || $receipts->isEmpty()) {
                throw new BusinessRuleViolation('LANDED_COST_VOUCHER_INCOMPLETE', "Landed cost voucher {$locked->number} needs at least one charge and one goods receipt.");
            }

            $table = $this->calculator->calculate($organizationId, $locked->currency, $charges->map(fn (LandedCostVoucherCharge $c) => [
                'amount' => $c->amount,
                'allocation' => $c->allocation->value,
            ])->all(), $receipts, lock: true);

            $reference = new StockReference('landed_cost_voucher', $locked->id, $locked->number);
            $levelKeys = array_keys($table['levels']);
            $moved = $this->valuation->revalue(array_map(fn (array $level) => new StockRevaluation(
                $level['store_id'], $level['variant_id'], $level['batch_id'], $level['amount'],
            ), array_values($table['levels'])), $reference);
            $movements = array_combine($levelKeys, $moved);

            $expense = null;
            if (Decimal::compare($table['consumed_total'], '0') > 0) {
                $expense = $this->expenses->recordSystemExpense([
                    'branch_id' => $locked->branch_id,
                    'category' => self::EXPENSE_CATEGORY,
                    'amount' => $table['consumed_total'],
                    'method' => PaymentMethod::BankTransfer,
                    'occurred_on' => $locked->voucher_date->toDateString(),
                    'reference' => $locked->number,
                    'party' => $supplier['name'],
                    'notes' => "Share of landed cost voucher {$locked->number} for stock no longer on hand; owed to {$supplier['name']} on account.",
                    'on_account' => true,
                ], (string) $actor->getAuthIdentifier());
            }

            $now = now();
            foreach ($table['lines'] as $position => $line) {
                $movement = Decimal::compare($line['on_hand_amount'], '0') > 0 ? ($movements[$line['level_key']] ?? null) : null;
                LandedCostAllocation::query()->create([
                    'organization_id' => $organizationId,
                    'landed_cost_voucher_id' => $locked->id,
                    'goods_receipt_id' => $line['goods_receipt_id'],
                    'goods_receipt_line_id' => $line['goods_receipt_line_id'],
                    'variant_id' => $line['variant_id'],
                    'store_id' => $line['store_id'],
                    'batch_id' => $line['batch_id'],
                    'received_quantity' => $line['received_quantity'],
                    'on_hand_quantity' => $line['on_hand_quantity'],
                    'amount' => $line['amount'],
                    'on_hand_amount' => $line['on_hand_amount'],
                    'consumed_amount' => $line['consumed_amount'],
                    'average_cost_before' => $movement['average_before'] ?? null,
                    'average_cost_after' => $movement['average_after'] ?? null,
                    'stock_movement_id' => $movement['movement_id'] ?? null,
                    'sort_order' => $position,
                    'created_at' => $now,
                ]);
            }

            $locked->forceFill([
                'status' => LandedCostVoucherStatus::Posted,
                'on_hand_total' => $table['on_hand_total'],
                'consumed_total' => $table['consumed_total'],
                'expense_id' => $expense['id'] ?? null,
                'expense_number' => $expense['number'] ?? null,
                'posted_by' => (string) $actor->getAuthIdentifier(),
                'posted_at' => $now,
                'updated_by' => (string) $actor->getAuthIdentifier(),
            ])->save();

            $this->audit->record('landed_cost_voucher.posted', $locked, old: ['status' => 'draft'], new: [
                'status' => 'posted',
                'number' => $locked->number,
                'total' => $locked->total,
                'on_hand_total' => $locked->on_hand_total,
                'consumed_total' => $locked->consumed_total,
                'expense_number' => $locked->expense_number,
                'receipts' => $receipts->pluck('number')->all(),
            ]);

            return $locked;
        });
    }
}
