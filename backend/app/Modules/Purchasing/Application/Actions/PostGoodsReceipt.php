<?php

namespace App\Modules\Purchasing\Application\Actions;

use App\Modules\Inventory\Application\Actions\ResolveBatch;
use App\Modules\Inventory\Application\Contracts\StockLedger;
use App\Modules\Inventory\Application\Services\StockLineRules;
use App\Modules\Inventory\Application\Services\StoreAccess;
use App\Modules\Inventory\Domain\MovementType;
use App\Modules\Inventory\Domain\StockChange;
use App\Modules\Inventory\Domain\StockReference;
use App\Modules\Purchasing\Application\Services\ProcurementHistory;
use App\Modules\Purchasing\Application\Services\PurchasingContext;
use App\Modules\Purchasing\Domain\LandedCost\LandedCostAllocator;
use App\Modules\Purchasing\Domain\PurchaseOrderStatus;
use App\Modules\Purchasing\Domain\PurchaseTotals;
use App\Modules\Purchasing\Infrastructure\Models\GoodsReceipt;
use App\Modules\Purchasing\Infrastructure\Models\PurchaseOrder;
use App\Modules\Purchasing\Infrastructure\Models\PurchaseOrderLine;
use App\Modules\Purchasing\Infrastructure\Models\SupplierProduct;
use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Application\Contracts\SequenceGenerator;
use App\Modules\Shared\Application\Contracts\TenantUser;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Shared\Domain\ValueObjects\Decimal;
use App\Modules\Shared\Domain\ValueObjects\Money;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Critical workflow #2: purchase and stock receiving.
 *
 * Posts a goods receipt (= the supplier's invoice) in one transaction: the document with
 * server-computed totals, stock in at the received unit cost (weighted average), batches,
 * and — when received against a purchase order — the order's received quantities and status.
 * Receiving more than is still open on an order line is refused.
 *
 * SC3: landed cost charges (freight, duty…) are allocated over the lines (LandedCostAllocator)
 * and the stock enters at unit cost + landed cost ÷ quantity. Charges without a charge
 * supplier are part of this invoice (`payable_total`); the others are payables on the charge
 * supplier's account (SupplierAccount).
 */
class PostGoodsReceipt
{
    public function __construct(
        private readonly PurchasingContext $context,
        private readonly StoreAccess $storeAccess,
        private readonly StockLineRules $lineRules,
        private readonly ResolveBatch $resolveBatch,
        private readonly StockLedger $ledger,
        private readonly SequenceGenerator $sequences,
        private readonly AuditTrail $audit,
        private readonly ProcurementHistory $history,
    ) {}

    /**
     * @param  array{supplier_id: string, store_id: string, purchase_order_id?: ?string, supplier_invoice_number?: ?string, invoice_date: string, due_date?: ?string, notes?: ?string, lines: list<array{variant_id: string, quantity: string, unit_cost: string, tax_rate?: ?string, purchase_order_line_id?: ?string, batch_number?: ?string, expires_on?: ?string, manufactured_on?: ?string}>, charges?: list<array{type: string, description?: ?string, amount: string, tax_amount?: ?string, allocation: string, charge_supplier_id?: ?string}>}  $data
     */
    public function __invoke(TenantUser $actor, array $data): GoodsReceipt
    {
        $organizationId = $this->context->organizationId();
        $supplier = $this->context->requireActiveSupplier($data['supplier_id']);
        $store = $this->storeAccess->require($actor, $data['store_id']);
        $lines = array_values($data['lines']);
        $variants = $this->lineRules->validate($organizationId, $lines, 'in', requireTracked: false, requireSellable: true);

        foreach ($lines as $i => $line) {
            $lines[$i]['tax_rate'] = Decimal::round($line['tax_rate'] ?? $variants[$line['variant_id']]['tax_rate'] ?? '0', 4);
        }
        $currency = $this->context->currency();
        $totals = PurchaseTotals::calculate($lines, $currency);
        $dueDate = $data['due_date'] ?? Carbon::parse($data['invoice_date'])->addDays($supplier['payment_terms_days'])->toDateString();
        $charges = $this->charges(array_values($data['charges'] ?? []));
        $landed = $this->landedCosts($charges, $lines, $totals, $currency);

        return DB::transaction(function () use ($actor, $organizationId, $store, $data, $lines, $totals, $currency, $dueDate, $charges, $landed) {
            $order = isset($data['purchase_order_id']) ? $this->lockOrder($data, $store['id'], $lines) : null;

            $receipt = GoodsReceipt::query()->create([
                'organization_id' => $organizationId,
                'number' => $this->sequences->next($organizationId, 'goods_receipt', 'GRN-'),
                'supplier_id' => $data['supplier_id'],
                'branch_id' => $store['branch_id'],
                'store_id' => $store['id'],
                'purchase_order_id' => $order?->id,
                'supplier_invoice_number' => filled($data['supplier_invoice_number'] ?? null) ? trim($data['supplier_invoice_number']) : null,
                'invoice_date' => $data['invoice_date'],
                'due_date' => $dueDate,
                'notes' => $data['notes'] ?? null,
                'currency' => $currency,
                'subtotal' => $totals['subtotal'],
                'tax_total' => $totals['tax_total'],
                'total' => $totals['total'],
                'charges_total' => $landed['charges_total'],
                'charges_tax_total' => $landed['charges_tax_total'],
                'landed_total' => $landed['landed_total'],
                'payable_total' => $landed['payable_total'],
                'created_by' => $actor->getAuthIdentifier(),
            ]);

            $now = now();
            foreach ($charges as $i => $charge) {
                $receipt->charges()->create([
                    'organization_id' => $organizationId,
                    'type' => $charge['type'],
                    'description' => $charge['description'],
                    'amount' => $charge['amount'],
                    'tax_amount' => $charge['tax_amount'],
                    'allocation' => $charge['allocation'],
                    'charge_supplier_id' => $charge['charge_supplier_id'],
                    'sort_order' => $i,
                    'created_at' => $now,
                ]);
            }

            $changes = [];
            $created = [];
            foreach ($lines as $i => $line) {
                $batchId = filled($line['batch_number'] ?? null)
                    ? ($this->resolveBatch)($line['variant_id'], $line['batch_number'], $line['expires_on'] ?? null, $line['manufactured_on'] ?? null)->id
                    : null;

                $created[] = $receipt->lines()->create([
                    'organization_id' => $organizationId,
                    'purchase_order_line_id' => $line['purchase_order_line_id'] ?? null,
                    'variant_id' => $line['variant_id'],
                    'batch_id' => $batchId,
                    'quantity' => Decimal::round($line['quantity'], 3),
                    'unit_cost' => Decimal::round($line['unit_cost'], 4),
                    'tax_rate' => $line['tax_rate'],
                    ...$totals['lines'][$i],
                    'landed_cost' => $landed['lines'][$i]['landed_cost'],
                    'landed_unit_cost' => $landed['lines'][$i]['landed_unit_cost'],
                ]);
                // SC3: stock enters at the landed unit cost, so the weighted average includes the charges.
                $changes[] = new StockChange($store['id'], $line['variant_id'], $batchId, MovementType::PurchaseReceipt, $line['quantity'], $landed['lines'][$i]['landed_unit_cost']);
            }

            $this->ledger->post($changes, new StockReference('goods_receipt', $receipt->id, $receipt->number));
            $this->recordCatalogCosts($receipt->supplier_id, $lines);

            if ($order !== null) {
                $this->updateOrder($order, $lines);
            }

            $this->audit->record('goods_receipt.posted', $receipt, new: [
                'number' => $receipt->number,
                'supplier_id' => $receipt->supplier_id,
                'purchase_order_id' => $receipt->purchase_order_id,
                'supplier_invoice_number' => $receipt->supplier_invoice_number,
                'total' => $receipt->total,
                'charges_total' => $receipt->charges_total,
                'payable_total' => $receipt->payable_total,
            ]);

            return $receipt;
        });
    }

    /**
     * SC3: normalized charges; a charge supplier must be an active supplier.
     *
     * @param  list<array<string, mixed>>  $charges
     * @return list<array{type: string, description: ?string, amount: string, tax_amount: string, allocation: string, charge_supplier_id: ?string}>
     */
    private function charges(array $charges): array
    {
        $normalized = [];
        foreach ($charges as $i => $charge) {
            $supplierId = $charge['charge_supplier_id'] ?? null;
            if ($supplierId !== null) {
                $this->context->requireActiveSupplier($supplierId, "charges.{$i}.charge_supplier_id");
            }
            $normalized[] = [
                'type' => (string) $charge['type'],
                'description' => filled($charge['description'] ?? null) ? trim((string) $charge['description']) : null,
                'amount' => Decimal::round((string) $charge['amount'], 2),
                'tax_amount' => Decimal::round((string) ($charge['tax_amount'] ?? '0'), 2),
                'allocation' => (string) $charge['allocation'],
                'charge_supplier_id' => $supplierId,
            ];
        }

        return $normalized;
    }

    /**
     * SC3: each charge spread over the lines (largest remainder, exact), the landed unit cost
     * per line, and the receipt's landed and payable totals.
     *
     * @param  list<array{type: string, description: ?string, amount: string, tax_amount: string, allocation: string, charge_supplier_id: ?string}>  $charges
     * @param  list<array<string, mixed>>  $lines
     * @param  array{lines: list<array{line_subtotal: string}>, subtotal: string, total: string}  $totals
     * @return array{lines: list<array{landed_cost: string, landed_unit_cost: string}>, charges_total: string, charges_tax_total: string, landed_total: string, payable_total: string}
     */
    private function landedCosts(array $charges, array $lines, array $totals, string $currency): array
    {
        $allocated = $charges === []
            ? ['lines' => array_fill(0, count($lines), Money::zero($currency)->amount())]
            : LandedCostAllocator::allocate($charges, array_map(fn (array $l, int $i) => [
                'quantity' => (string) $l['quantity'],
                'value' => $totals['lines'][$i]['line_subtotal'],
            ], $lines, array_keys($lines)), $currency);

        $chargesTotal = Money::zero($currency);
        $chargesTax = Money::zero($currency);
        $payable = Money::of($totals['total'], $currency);
        foreach ($charges as $charge) {
            $chargesTotal = $chargesTotal->plus(Money::of($charge['amount'], $currency));
            $chargesTax = $chargesTax->plus(Money::of($charge['tax_amount'], $currency));
            if ($charge['charge_supplier_id'] === null) {
                $payable = $payable->plus(Money::of($charge['amount'], $currency))->plus(Money::of($charge['tax_amount'], $currency));
            }
        }

        return [
            'lines' => array_map(fn (array $l, int $i) => [
                'landed_cost' => $allocated['lines'][$i],
                'landed_unit_cost' => LandedCostAllocator::landedUnitCost((string) $l['unit_cost'], $allocated['lines'][$i], (string) $l['quantity']),
            ], $lines, array_keys($lines)),
            'charges_total' => $chargesTotal->amount(),
            'charges_tax_total' => $chargesTax->amount(),
            'landed_total' => Money::of($totals['subtotal'], $currency)->plus($chargesTotal)->amount(),
            'payable_total' => $payable->amount(),
        ];
    }

    /**
     * SC1: the supplier's catalog rows for the received variants remember the cost of this
     * receipt (the last line wins when a variant appears twice). Rows are never created here.
     *
     * @param  list<array<string, mixed>>  $lines
     */
    private function recordCatalogCosts(string $supplierId, array $lines): void
    {
        $costs = [];
        foreach ($lines as $line) {
            $costs[$line['variant_id']] = Decimal::round($line['unit_cost'], 4);
        }
        $now = now();
        foreach ($costs as $variantId => $cost) {
            SupplierProduct::query()->where('supplier_id', $supplierId)->where('variant_id', $variantId)
                ->update(['last_purchase_cost' => $cost, 'last_purchased_at' => $now]);
        }
    }

    /**
     * Locks the order and checks every line is open on it.
     *
     * @param  array<string, mixed>  $data
     * @param  list<array<string, mixed>>  $lines
     */
    private function lockOrder(array $data, string $storeId, array $lines): PurchaseOrder
    {
        $order = PurchaseOrder::query()->whereKey($data['purchase_order_id'])->lockForUpdate()->first()
            ?? throw ValidationException::withMessages(['purchase_order_id' => ['The selected purchase order does not exist.']]);

        if (! $order->status->acceptsReceipts()) {
            throw new BusinessRuleViolation('PURCHASE_ORDER_NOT_OPEN', "Purchase order {$order->number} is {$order->status->value}.");
        }
        if ($order->supplier_id !== $data['supplier_id'] || $order->store_id !== $storeId) {
            throw ValidationException::withMessages(['purchase_order_id' => ['The purchase order is for another supplier or store.']]);
        }

        $orderLines = $order->lines()->get()->keyBy('id');
        $receiving = [];
        $errors = [];
        foreach ($lines as $i => $line) {
            $orderLine = $orderLines[$line['purchase_order_line_id'] ?? ''] ?? null;
            if ($orderLine === null || $orderLine->variant_id !== $line['variant_id']) {
                $errors["lines.{$i}.purchase_order_line_id"] = ['Each line must match a line of the purchase order.'];

                continue;
            }
            $receiving[$orderLine->id] = Decimal::add($receiving[$orderLine->id] ?? '0', $line['quantity'], 3);
            $open = Decimal::sub($orderLine->quantity, $orderLine->received_quantity, 3);
            if (Decimal::compare($receiving[$orderLine->id], $open) > 0) {
                $errors["lines.{$i}.quantity"] = ["Only {$open} still open on the order."];
            }
        }
        if ($errors !== []) {
            throw ValidationException::withMessages($errors);
        }

        return $order;
    }

    /**
     * @param  list<array<string, mixed>>  $lines
     */
    private function updateOrder(PurchaseOrder $order, array $lines): void
    {
        $orderLines = $order->lines()->get()->keyBy('id');
        foreach ($lines as $line) {
            /** @var PurchaseOrderLine $orderLine */
            $orderLine = $orderLines[$line['purchase_order_line_id']];
            $orderLine->received_quantity = Decimal::add($orderLine->received_quantity, $line['quantity'], 3);
            $orderLine->save();
        }

        $complete = $orderLines->every(fn (PurchaseOrderLine $l) => Decimal::compare($l->received_quantity, $l->quantity) >= 0);
        $from = $order->status;
        $order->forceFill(['status' => $complete ? PurchaseOrderStatus::Received : PurchaseOrderStatus::PartiallyReceived])->save();
        if ($order->status !== $from) {
            $this->history->order($order, $from->value, $order->status->value);
        }
    }
}
