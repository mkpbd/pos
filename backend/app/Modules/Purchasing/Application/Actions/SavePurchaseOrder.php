<?php

namespace App\Modules\Purchasing\Application\Actions;

use App\Modules\Inventory\Application\Services\StockLineRules;
use App\Modules\Inventory\Application\Services\StoreAccess;
use App\Modules\Purchasing\Application\Services\PurchasingContext;
use App\Modules\Purchasing\Domain\PurchaseOrderStatus;
use App\Modules\Purchasing\Domain\PurchaseTotals;
use App\Modules\Purchasing\Infrastructure\Models\PurchaseOrder;
use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Application\Contracts\SequenceGenerator;
use App\Modules\Shared\Application\Contracts\TenantUser;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Shared\Domain\ValueObjects\Decimal;
use Illuminate\Support\Facades\DB;

/**
 * Creates or replaces a draft purchase order. Totals are always computed here from
 * quantities, unit costs and tax rates; client-side totals are never accepted.
 */
class SavePurchaseOrder
{
    public function __construct(
        private readonly PurchasingContext $context,
        private readonly StoreAccess $storeAccess,
        private readonly StockLineRules $lineRules,
        private readonly SequenceGenerator $sequences,
        private readonly AuditTrail $audit,
    ) {}

    /**
     * @param  array{supplier_id: string, store_id: string, order_date: string, expected_date?: ?string, notes?: ?string, lines: list<array{variant_id: string, quantity: string, unit_cost: string, tax_rate?: ?string}>}  $data
     */
    public function __invoke(TenantUser $actor, ?PurchaseOrder $order, array $data): PurchaseOrder
    {
        if ($order !== null && $order->status !== PurchaseOrderStatus::Draft) {
            throw new BusinessRuleViolation('PURCHASE_ORDER_LOCKED', "Purchase order {$order->number} is {$order->status->value} and can no longer be edited.");
        }

        $organizationId = $this->context->organizationId();
        $this->context->requireActiveSupplier($data['supplier_id']);
        $store = $this->storeAccess->require($actor, $data['store_id']);
        $lines = array_values($data['lines']);
        $variants = $this->lineRules->validate($organizationId, $lines, 'in', requireTracked: false, checkBatches: false, requireSellable: true);

        foreach ($lines as $i => $line) {
            $lines[$i]['tax_rate'] = Decimal::round($line['tax_rate'] ?? $variants[$line['variant_id']]['tax_rate'] ?? '0', 4);
        }
        $currency = $this->context->currency();
        $totals = PurchaseTotals::calculate($lines, $currency);

        return DB::transaction(function () use ($order, $organizationId, $store, $data, $lines, $totals, $currency) {
            $creating = $order === null;
            $order ??= new PurchaseOrder([
                'organization_id' => $organizationId,
                'number' => $this->sequences->next($organizationId, 'purchase_order', 'PO-'),
                'status' => PurchaseOrderStatus::Draft,
            ]);

            $order->fill([
                'supplier_id' => $data['supplier_id'],
                'branch_id' => $store['branch_id'],
                'store_id' => $store['id'],
                'order_date' => $data['order_date'],
                'expected_date' => $data['expected_date'] ?? null,
                'notes' => $data['notes'] ?? null,
                'currency' => $currency,
                'subtotal' => $totals['subtotal'],
                'tax_total' => $totals['tax_total'],
                'total' => $totals['total'],
            ])->save();

            $order->lines()->delete();
            foreach ($lines as $i => $line) {
                $order->lines()->create([
                    'organization_id' => $organizationId,
                    'variant_id' => $line['variant_id'],
                    'quantity' => Decimal::round($line['quantity'], 3),
                    'unit_cost' => Decimal::round($line['unit_cost'], 4),
                    'tax_rate' => $line['tax_rate'],
                    'sort_order' => $i,
                    ...$totals['lines'][$i],
                ]);
            }

            $this->audit->record($creating ? 'purchase_order.created' : 'purchase_order.updated', $order, new: [
                'number' => $order->number,
                'supplier_id' => $order->supplier_id,
                'total' => $order->total,
                'lines' => count($lines),
            ]);

            return $order;
        });
    }
}
