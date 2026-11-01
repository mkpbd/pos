<?php

namespace App\Modules\OnlineCatalog\Application\Actions;

use App\Modules\OnlineCatalog\Infrastructure\Models\ProductListing;
use App\Modules\OnlineCatalog\Infrastructure\Models\RelatedProduct;
use App\Modules\OnlineCatalog\Infrastructure\ReadModels\CatalogReadModel;
use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Application\Contracts\StorefrontContentVersion;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Replaces a product's hand-picked "related" and "frequently bought together" lists
 * (ordered, at most twelve each, products of the same organization, never itself).
 */
class SaveRelatedProducts
{
    public function __construct(
        private readonly CatalogReadModel $catalog,
        private readonly AuditTrail $audit,
    ) {}

    /**
     * @param  array{related?: list<string>, frequently_bought?: list<string>}  $lists
     */
    public function __invoke(string $productId, array $lists): void
    {
        if ($this->catalog->adminProducts([$productId]) === []) {
            throw (new ModelNotFoundException)->setModel(ProductListing::class, [$productId]);
        }

        $errors = [];
        foreach (RelatedProduct::KINDS as $kind) {
            foreach (array_values($lists[$kind] ?? []) as $i => $id) {
                if ($id === $productId) {
                    $errors["{$kind}.{$i}"] = ['A product cannot be related to itself.'];
                }
            }
        }
        if ($errors !== []) {
            throw ValidationException::withMessages($errors);
        }

        $ids = array_values(array_unique(array_merge(...array_map(fn (string $k) => array_values($lists[$k] ?? []), RelatedProduct::KINDS))));
        $missing = array_values(array_diff($ids, array_keys($this->catalog->adminProducts($ids))));
        if ($missing !== []) {
            throw new BusinessRuleViolation('PRODUCT_NOT_FOUND', 'Some selected products do not exist or were archived.', ['product_ids' => $missing]);
        }

        DB::transaction(function () use ($productId, $lists) {
            $before = $this->lists($productId);
            RelatedProduct::query()->where('product_id', $productId)->delete();
            app(StorefrontContentVersion::class)->bump($this->catalog->organizationId());
            foreach (RelatedProduct::KINDS as $kind) {
                foreach (array_values($lists[$kind] ?? []) as $position => $id) {
                    RelatedProduct::query()->create([
                        'product_id' => $productId,
                        'related_product_id' => $id,
                        'kind' => $kind,
                        'sort_order' => $position,
                    ]);
                }
            }

            $after = $this->lists($productId);
            if ($before !== $after) {
                $this->audit->record('online_catalog.related_products.saved', null, $before, $after, ['product_id' => $productId]);
            }
        });
    }

    /**
     * @return array<string, list<string>>
     */
    private function lists(string $productId): array
    {
        $rows = RelatedProduct::query()->where('product_id', $productId)->orderBy('kind')->orderBy('sort_order')->get();
        $result = array_fill_keys(RelatedProduct::KINDS, []);
        foreach ($rows as $row) {
            $result[$row->kind][] = $row->related_product_id;
        }

        return $result;
    }
}
