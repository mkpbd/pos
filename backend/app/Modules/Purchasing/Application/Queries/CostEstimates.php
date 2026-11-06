<?php

namespace App\Modules\Purchasing\Application\Queries;

use App\Modules\Products\Application\Contracts\ProductDirectory;
use App\Modules\Purchasing\Infrastructure\Models\SupplierProduct;
use App\Modules\Shared\Domain\ValueObjects\Decimal;
use App\Modules\Suppliers\Application\Contracts\SupplierDirectory;

/**
 * Estimated unit costs for requisition lines (SC2): the suggested supplier's active catalog
 * row, else the preferred catalog row, else the last goods receipt cost, else the variant's
 * purchase price — with the preferred supplier to default to when converting.
 */
class CostEstimates
{
    public function __construct(
        private readonly ReorderSuggestions $suggestions,
        private readonly ProductDirectory $products,
        private readonly SupplierDirectory $suppliers,
    ) {}

    /**
     * @param  list<string>  $variantIds
     * @param  array<string, ?string>  $suggestedSuppliers  variant id => supplier id
     * @return array<string, array{variant_id: string, estimated_unit_cost: string, source: string, tax_rate: string, preferred_supplier: ?array{id: string, code: string, name: string}}>
     */
    public function forVariants(string $organizationId, array $variantIds, array $suggestedSuppliers = []): array
    {
        $variantIds = array_values(array_unique($variantIds));
        if ($variantIds === []) {
            return [];
        }
        $variants = $this->products->variants($organizationId, $variantIds);
        $preferred = $this->suggestions->preferredCatalog($organizationId, $variantIds);

        $pairs = array_filter($suggestedSuppliers);
        $supplierRows = $pairs === [] ? collect() : SupplierProduct::query()
            ->whereIn('supplier_id', array_values(array_unique($pairs)))
            ->whereIn('variant_id', array_keys($pairs))
            ->where('is_active', true)
            ->get()
            ->keyBy(fn (SupplierProduct $p) => $p->supplier_id.'|'.$p->variant_id);

        $withoutCatalog = array_values(array_filter($variantIds, fn (string $id) => ! isset($preferred[$id]) && ! $supplierRows->has(($pairs[$id] ?? '').'|'.$id)));
        $lastCosts = $this->suggestions->lastPurchaseCosts($organizationId, $withoutCatalog);
        $names = $this->suppliers->summaries($organizationId, array_values(array_unique(array_column($preferred, 'supplier_id'))));

        $out = [];
        foreach ($variantIds as $id) {
            $variant = $variants[$id] ?? null;
            if ($variant === null) {
                continue;
            }
            $own = $supplierRows->get(($pairs[$id] ?? '').'|'.$id);
            [$cost, $source] = match (true) {
                $own !== null => [$own->unit_cost, 'supplier_catalog'],
                isset($preferred[$id]) => [$preferred[$id]['unit_cost'], 'preferred_catalog'],
                isset($lastCosts[$id]) => [$lastCosts[$id], 'last_cost'],
                default => [Decimal::round($variant['purchase_price'], 4), 'variant_cost'],
            };
            $preferredSupplier = isset($preferred[$id]) ? ($names[$preferred[$id]['supplier_id']] ?? null) : null;
            $out[$id] = [
                'variant_id' => $id,
                'estimated_unit_cost' => Decimal::round((string) $cost, 4),
                'source' => $source,
                'tax_rate' => Decimal::round($variant['tax_rate'] ?? '0', 4),
                'preferred_supplier' => $preferredSupplier === null ? null : ['id' => $preferredSupplier['id'], 'code' => $preferredSupplier['code'], 'name' => $preferredSupplier['name']],
            ];
        }

        return $out;
    }
}
