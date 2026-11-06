<?php

namespace App\Modules\Purchasing\Application\Actions;

use App\Modules\Inventory\Application\Services\StockLineRules;
use App\Modules\Inventory\Application\Services\StoreAccess;
use App\Modules\Organizations\Application\Support\OrganizationDate;
use App\Modules\Purchasing\Application\Services\PurchasingContext;
use App\Modules\Purchasing\Infrastructure\Models\PurchaseOrder;
use App\Modules\Purchasing\Infrastructure\Models\SupplierProduct;
use App\Modules\Shared\Application\Contracts\TenantUser;
use App\Modules\Suppliers\Application\Contracts\SupplierDirectory;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Turns selected reorder suggestions into draft purchase orders (SC1): one draft per
 * supplier, through SavePurchaseOrder (server-side totals, numbering, audit), all in one
 * transaction. Order date = today in the organization's timezone; expected date = today +
 * the longest catalog lead time among the order's lines (7 days without a catalog row).
 * The route is idempotent (Idempotency-Key), so a retry never creates a second set.
 */
class CreateReorderPurchaseOrders
{
    public function __construct(
        private readonly PurchasingContext $context,
        private readonly StoreAccess $storeAccess,
        private readonly StockLineRules $lineRules,
        private readonly SupplierDirectory $suppliers,
        private readonly OrganizationDate $dates,
        private readonly SavePurchaseOrder $save,
    ) {}

    /**
     * @param  array{store_id: string, lines: list<array{variant_id: string, supplier_id: string, quantity: string, unit_cost: string}>}  $data
     * @return list<PurchaseOrder>
     */
    public function __invoke(TenantUser $actor, array $data): array
    {
        $organizationId = $this->context->organizationId();
        $store = $this->storeAccess->require($actor, $data['store_id']);
        $lines = array_values($data['lines']);
        $this->lineRules->validate($organizationId, $lines, 'in', requireTracked: true, checkBatches: false, requireSellable: true);

        $errors = [];
        $groups = [];
        foreach ($lines as $i => $line) {
            $supplier = $this->suppliers->find($line['supplier_id'], $organizationId);
            if ($supplier === null || $supplier['archived']) {
                $errors["lines.{$i}.supplier_id"] = ['The selected supplier does not exist.'];
            } elseif (! $supplier['is_active']) {
                $errors["lines.{$i}.supplier_id"] = ["{$supplier['name']} is inactive."];
            }
            $groups[$line['supplier_id']][] = $line;
        }
        if ($errors !== []) {
            throw ValidationException::withMessages($errors);
        }

        $leadTimes = SupplierProduct::query()
            ->whereIn('supplier_id', array_keys($groups))
            ->whereIn('variant_id', array_column($lines, 'variant_id'))
            ->get(['supplier_id', 'variant_id', 'lead_time_days'])
            ->mapWithKeys(fn (SupplierProduct $p) => [$p->supplier_id.'|'.$p->variant_id => $p->lead_time_days]);
        $today = CarbonImmutable::parse($this->dates->today());

        return DB::transaction(function () use ($actor, $store, $groups, $leadTimes, $today) {
            $orders = [];
            foreach ($groups as $supplierId => $supplierLines) {
                $lead = max(array_map(fn (array $l) => $leadTimes[$supplierId.'|'.$l['variant_id']] ?? SupplierProduct::DEFAULT_LEAD_TIME_DAYS, $supplierLines));
                $orders[] = ($this->save)($actor, null, [
                    'supplier_id' => $supplierId,
                    'store_id' => $store['id'],
                    'order_date' => $today->toDateString(),
                    'expected_date' => $today->addDays($lead)->toDateString(),
                    'notes' => 'Created from reorder suggestions.',
                    'lines' => array_map(fn (array $l) => [
                        'variant_id' => $l['variant_id'],
                        'quantity' => $l['quantity'],
                        'unit_cost' => $l['unit_cost'],
                    ], $supplierLines),
                ]);
            }

            return $orders;
        });
    }
}
