<?php

namespace App\Modules\Products\Application\Actions;

use App\Modules\Catalog\Application\Contracts\CatalogDirectory;
use App\Modules\Products\Application\Contracts\ProductCategoryAssignment;
use App\Modules\Products\Infrastructure\Models\Product;
use App\Modules\Shared\Application\Contracts\AuditTrail;
use Illuminate\Support\Facades\DB;

/**
 * AI2a: Products' ProductCategoryAssignment — changes only `category_id` of the given products
 * (locked for update, one transaction), audited per product like SaveProduct does.
 */
class AssignProductCategories implements ProductCategoryAssignment
{
    public function __construct(
        private readonly CatalogDirectory $catalog,
        private readonly AuditTrail $audit,
    ) {}

    public function assign(string $organizationId, array $assignments, array $auditContext = []): array
    {
        $categoryIds = array_values(array_unique(array_column($assignments, 'category_id')));
        $validCategories = [];
        foreach ($categoryIds as $categoryId) {
            if ($this->catalog->invalidReferences($organizationId, ['category_id' => $categoryId]) === []) {
                $validCategories[$categoryId] = true;
            }
        }

        return DB::transaction(function () use ($organizationId, $assignments, $validCategories, $auditContext) {
            $products = Product::query()->withoutGlobalScope('organization')
                ->where('organization_id', $organizationId)
                ->whereKey(array_values(array_unique(array_column($assignments, 'product_id'))))
                ->orderBy('id')
                ->lockForUpdate()
                ->get()
                ->keyBy('id');

            $applied = [];
            $skipped = [];
            foreach ($assignments as $assignment) {
                $productId = $assignment['product_id'];
                $categoryId = $assignment['category_id'];
                /** @var Product|null $product */
                $product = $products->get($productId);
                $reason = match (true) {
                    $product === null => self::SKIP_PRODUCT_NOT_FOUND,
                    ! isset($validCategories[$categoryId]) => self::SKIP_CATEGORY_NOT_FOUND,
                    $product->category_id === $categoryId => self::SKIP_UNCHANGED,
                    default => null,
                };
                if ($reason !== null) {
                    $skipped[] = ['product_id' => $productId, 'reason' => $reason];

                    continue;
                }

                $old = $product->category_id;
                $product->category_id = $categoryId;
                $product->save();
                $this->audit->record('product.updated', $product, ['category_id' => $old], ['category_id' => $categoryId], $auditContext);
                $applied[] = $productId;
            }

            return ['applied' => $applied, 'skipped' => $skipped];
        });
    }
}
