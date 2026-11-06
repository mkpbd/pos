<?php

namespace App\Modules\Purchasing\Application\Queries;

use App\Modules\Branches\Application\Contracts\BranchDirectory;
use App\Modules\Inventory\Application\Contracts\ReplenishmentData;
use App\Modules\Products\Application\Contracts\ProductDirectory;
use App\Modules\Purchasing\Domain\PurchaseOrderStatus;
use App\Modules\Purchasing\Domain\Reorder\ReorderCalculator;
use App\Modules\Purchasing\Domain\Reorder\ReorderInput;
use App\Modules\Purchasing\Infrastructure\Models\SupplierProduct;
use App\Modules\Shared\Domain\ValueObjects\Decimal;
use App\Modules\Suppliers\Application\Contracts\SupplierDirectory;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

/**
 * Reorder suggestions for one store (SC1): gathers the inputs — stock, transfers in transit,
 * net sales and rules from Inventory, open purchase orders and the supplier catalog from this
 * module, product settings from Products — and runs the pure ReorderCalculator per variant.
 * Only stock-tracked, sellable variants with something to transfer or buy are returned,
 * ordered by product and variant name.
 */
class ReorderSuggestions
{
    public function __construct(
        private readonly ReplenishmentData $replenishment,
        private readonly ProductDirectory $products,
        private readonly SupplierDirectory $suppliers,
        private readonly BranchDirectory $branches,
    ) {}

    /**
     * @param  array{supplier_id?: ?string, search?: ?string, only?: ?string}  $filters
     * @return array{settings: array{source_store_id: ?string, coverage_days: int, velocity_days: int, safety_days: int}, source_store: ?array<string, mixed>, rows: list<array<string, mixed>>}
     */
    public function forStore(string $organizationId, string $storeId, array $filters = []): array
    {
        $settings = $this->replenishment->settings($organizationId);
        $since = CarbonImmutable::now()->subDays($settings['velocity_days']);
        $inputs = $this->replenishment->storeInputs($organizationId, $storeId, $since);

        $variants = array_filter(
            $this->products->variants($organizationId, array_keys($inputs)),
            fn (array $v) => $v['track_stock'] && $v['sellable'],
        );
        $search = trim((string) ($filters['search'] ?? ''));
        if ($search !== '') {
            $variants = array_intersect_key($variants, array_flip($this->products->searchVariantIds($organizationId, $search, 2000)));
        }
        $ids = array_keys($variants);

        $preferred = $this->preferredCatalog($organizationId, $ids);
        $onOrder = $this->openOrderQuantities($organizationId, $storeId, $ids, [PurchaseOrderStatus::Ordered, PurchaseOrderStatus::PartiallyReceived]);
        $drafts = $this->openOrderQuantities($organizationId, $storeId, $ids, [PurchaseOrderStatus::Draft]);
        $source = $this->sourceStore($organizationId, $settings['source_store_id'], $storeId);

        // First pass without a source, to find what needs reordering at all.
        $calculate = function (string $variantId, ?string $surplus) use ($inputs, $variants, $preferred, $onOrder, $settings) {
            $in = $inputs[$variantId];
            $catalog = $preferred[$variantId] ?? null;

            return ReorderCalculator::calculate(new ReorderInput(
                onHand: $in['on_hand'],
                onOrder: $onOrder[$variantId] ?? '0.000',
                inTransit: $in['in_transit'],
                sold: $in['sold'],
                velocityDays: $settings['velocity_days'],
                minQty: $in['min_qty'],
                maxQty: $in['max_qty'],
                leadTimeDays: $catalog['lead_time_days'] ?? SupplierProduct::DEFAULT_LEAD_TIME_DAYS,
                safetyDays: $settings['safety_days'],
                coverageDays: $settings['coverage_days'],
                packSize: $catalog['pack_size'] ?? '1',
                minOrderQty: $catalog['min_order_qty'] ?? null,
                wholeUnits: ! $variants[$variantId]['allow_decimal'],
                sourceSurplus: $surplus,
            ));
        };
        $results = [];
        foreach ($ids as $variantId) {
            $result = $calculate($variantId, null);
            if ($result->hasSuggestion()) {
                $results[$variantId] = $result;
            }
        }

        if ($source !== null && $results !== []) {
            $sourceInputs = $this->replenishment->storeInputs($organizationId, $source['id'], $since, array_keys($results));
            foreach (array_keys($results) as $variantId) {
                $s = $sourceInputs[$variantId] ?? null;
                if ($s === null) {
                    continue;
                }
                $point = ReorderCalculator::reorderPoint($s['sold'], $settings['velocity_days'], $s['min_qty'],
                    $preferred[$variantId]['lead_time_days'] ?? SupplierProduct::DEFAULT_LEAD_TIME_DAYS, $settings['safety_days']);
                $surplus = ReorderCalculator::surplus($s['on_hand'], $point, ! $variants[$variantId]['allow_decimal']);
                if (Decimal::compare($surplus, '0') > 0) {
                    $results[$variantId] = $calculate($variantId, $surplus);
                }
            }
        }

        $lastCosts = $this->lastPurchaseCosts($organizationId, array_values(array_diff(array_keys($results), array_keys($preferred))));
        $supplierNames = $this->suppliers->summaries($organizationId, array_values(array_unique(array_column($preferred, 'supplier_id'))));

        $rows = [];
        foreach ($results as $variantId => $r) {
            $v = $variants[$variantId];
            $catalog = $preferred[$variantId] ?? null;
            $supplier = $catalog === null ? null : ($supplierNames[$catalog['supplier_id']] ?? null);
            $rows[] = [
                'variant' => [
                    'id' => $variantId,
                    'sku' => $v['sku'],
                    'product_name' => $v['product_name'],
                    'variant_name' => $v['variant_name'],
                    'unit' => $v['unit_code'],
                    'allow_decimal' => $v['allow_decimal'],
                ],
                'on_hand' => $inputs[$variantId]['on_hand'],
                'on_order' => $onOrder[$variantId] ?? '0.000',
                'in_transit' => $inputs[$variantId]['in_transit'],
                'avg_daily' => $r->avgDaily,
                'reorder_point' => $r->reorderPoint,
                'target' => $r->target,
                'suggested_purchase' => $r->suggestedPurchase,
                'suggested_transfer' => $r->suggestedTransfer,
                'supplier' => $supplier === null ? null : ['id' => $supplier['id'], 'code' => $supplier['code'], 'name' => $supplier['name']],
                'unit_cost' => $catalog['unit_cost'] ?? $lastCosts[$variantId] ?? Decimal::round($v['purchase_price'], 4),
                'lead_time_days' => $catalog['lead_time_days'] ?? SupplierProduct::DEFAULT_LEAD_TIME_DAYS,
                'reason' => $r->reason?->value,
                'days_of_cover' => $r->daysOfCover,
                // Additional context for the reorder screen.
                'pack_size' => $catalog['pack_size'] ?? '1.000',
                'min_order_qty' => $catalog['min_order_qty'] ?? null,
                'min_qty' => $inputs[$variantId]['min_qty'],
                'max_qty' => $inputs[$variantId]['max_qty'],
                'has_rule' => $inputs[$variantId]['has_rule'],
                'draft_on_order' => $drafts[$variantId] ?? '0.000',
            ];
        }

        $supplierId = $filters['supplier_id'] ?? null;
        $only = $filters['only'] ?? null;
        $rows = array_values(array_filter($rows, fn (array $row) => ($supplierId === null || ($row['supplier']['id'] ?? null) === $supplierId)
            && ($only !== 'purchase' || Decimal::compare($row['suggested_purchase'], '0') > 0)
            && ($only !== 'transfer' || Decimal::compare($row['suggested_transfer'], '0') > 0)));
        usort($rows, fn (array $a, array $b) => [mb_strtolower($a['variant']['product_name']), mb_strtolower((string) $a['variant']['variant_name']), $a['variant']['sku']]
            <=> [mb_strtolower($b['variant']['product_name']), mb_strtolower((string) $b['variant']['variant_name']), $b['variant']['sku']]);

        return ['settings' => $settings, 'source_store' => $source, 'rows' => $rows];
    }

    /**
     * The usable preferred catalog row per variant: active, of an active, non-archived supplier.
     *
     * @param  list<string>  $variantIds
     * @return array<string, array{supplier_id: string, unit_cost: string, pack_size: string, min_order_qty: ?string, lead_time_days: int}>
     */
    public function preferredCatalog(string $organizationId, array $variantIds): array
    {
        if ($variantIds === []) {
            return [];
        }
        $rows = SupplierProduct::query()->withoutGlobalScope('organization')
            ->where('organization_id', $organizationId)
            ->whereIn('variant_id', $variantIds)
            ->where('is_preferred', true)
            ->where('is_active', true)
            ->get();

        $usable = [];
        $suppliers = [];
        foreach ($rows as $row) {
            $supplier = $suppliers[$row->supplier_id] ??= $this->suppliers->find($row->supplier_id, $organizationId);
            if ($supplier === null || $supplier['archived'] || ! $supplier['is_active']) {
                continue;
            }
            $usable[$row->variant_id] = [
                'supplier_id' => $row->supplier_id,
                'unit_cost' => $row->unit_cost,
                'pack_size' => $row->pack_size,
                'min_order_qty' => $row->min_order_qty,
                'lead_time_days' => $row->lead_time_days,
            ];
        }

        return $usable;
    }

    /**
     * The store, when it is an active source other than the store being replenished.
     *
     * @return array{id: string, code: string, name: string, branch_id: string, branch_name: string}|null
     */
    private function sourceStore(string $organizationId, ?string $sourceStoreId, string $storeId): ?array
    {
        if ($sourceStoreId === null || $sourceStoreId === $storeId) {
            return null;
        }
        $store = $this->branches->store($sourceStoreId, $organizationId);
        if ($store === null || ! $store['is_active'] || ! $store['branch_is_active']) {
            return null;
        }

        return ['id' => $store['id'], 'code' => $store['code'], 'name' => $store['name'], 'branch_id' => $store['branch_id'], 'branch_name' => $store['branch_name']];
    }

    /**
     * Ordered but not yet received quantities per variant on the store's purchase orders.
     *
     * @param  list<string>  $variantIds
     * @param  list<PurchaseOrderStatus>  $statuses
     * @return array<string, string>
     */
    private function openOrderQuantities(string $organizationId, string $storeId, array $variantIds, array $statuses): array
    {
        if ($variantIds === []) {
            return [];
        }

        return DB::table('purchase_order_lines as l')
            ->join('purchase_orders as o', 'o.id', '=', 'l.purchase_order_id')
            ->where('o.organization_id', $organizationId)
            ->where('o.store_id', $storeId)
            ->whereIn('o.status', array_map(fn (PurchaseOrderStatus $s) => $s->value, $statuses))
            ->whereIn('l.variant_id', $variantIds)
            ->groupBy('l.variant_id')
            ->selectRaw('l.variant_id as variant_id, SUM(l.quantity - l.received_quantity) as total')
            ->pluck('total', 'variant_id')
            ->map(fn ($q) => Decimal::max(Decimal::round(self::plain($q), 3), '0.000'))
            ->all();
    }

    /**
     * Unit cost of each variant's most recent goods receipt line.
     *
     * @param  list<string>  $variantIds
     * @return array<string, string>
     */
    private function lastPurchaseCosts(string $organizationId, array $variantIds): array
    {
        if ($variantIds === []) {
            return [];
        }

        $costs = [];
        DB::table('goods_receipt_lines as l')
            ->join('goods_receipts as r', 'r.id', '=', 'l.goods_receipt_id')
            ->where('r.organization_id', $organizationId)
            ->whereIn('l.variant_id', $variantIds)
            ->orderByDesc('r.invoice_date')->orderByDesc('r.created_at')
            ->get(['l.variant_id', 'l.unit_cost'])
            ->each(function ($line) use (&$costs) {
                $costs[$line->variant_id] ??= Decimal::round(self::plain($line->unit_cost), 4);
            });

        return $costs;
    }

    private static function plain(mixed $value): string
    {
        $value = (string) ($value ?? '0');

        return preg_match('/[eE]/', $value) ? number_format((float) $value, 6, '.', '') : $value;
    }
}
