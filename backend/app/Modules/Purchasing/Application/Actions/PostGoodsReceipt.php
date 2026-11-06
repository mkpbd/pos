<?php

namespace App\Modules\Purchasing\Application\Actions;

use App\Modules\Inventory\Application\Actions\ResolveBatch;
use App\Modules\Inventory\Application\Contracts\StockLedger;
use App\Modules\Inventory\Application\Services\StockLineRules;
use App\Modules\Inventory\Application\Services\StoreAccess;
use App\Modules\Inventory\Domain\MovementType;
use App\Modules\Inventory\Domain\StockChange;
use App\Modules\Inventory\Domain\StockReference;
use App\Modules\Purchasing\Application\Services\PurchasingContext;
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
    ) {}

    /**
     * @param  array{supplier_id: string, store_id: string, purchase_order_id?: ?string, supplier_invoice_number?: ?string, invoice_date: string, due_date?: ?string, notes?: ?string, lines: list<array{variant_id: string, quantity: string, unit_cost: string, tax_rate?: ?string, purchase_order_line_id?: ?string, batch_number?: ?string, expires_on?: ?string, manufactured_on?: ?string}>}  $data
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

        return DB::transaction(function () use ($actor, $organizationId, $store, $data, $lines, $totals, $currency, $dueDate) {
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
                'created_by' => $actor->getAuthIdentifier(),
            ]);

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
                ]);
                $changes[] = new StockChange($store['id'], $line['variant_id'], $batchId, MovementType::PurchaseReceipt, $line['quantity'], $line['unit_cost']);
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
            ]);

            return $receipt;
        });
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
        $order->forceFill(['status' => $complete ? PurchaseOrderStatus::Received : PurchaseOrderStatus::PartiallyReceived])->save();
    }
}
