<?php

namespace App\Modules\OnlineCatalog\Application\Queries;

use App\Modules\OnlineCatalog\Infrastructure\Models\BackInStockRequest;
use App\Modules\OnlineCatalog\Infrastructure\ReadModels\CatalogReadModel;
use App\Modules\Products\Application\Contracts\ProductDirectory;
use Illuminate\Contracts\Pagination\LengthAwarePaginator;
use Illuminate\Database\Eloquent\ModelNotFoundException;

/**
 * P1a: a product's back-in-stock requests for staff, newest first.
 */
class BackInStockRequests
{
    public function __construct(
        private readonly CatalogReadModel $catalog,
        private readonly ProductDirectory $products,
    ) {}

    /**
     * @param  'open'|'notified'|null  $status
     * @return array{page: LengthAwarePaginator<int, BackInStockRequest>, row: callable(BackInStockRequest): array<string, mixed>}
     */
    public function forProduct(string $productId, ?string $status, int $perPage): array
    {
        $product = $this->catalog->adminProducts([$productId])[$productId]
            ?? throw (new ModelNotFoundException)->setModel(BackInStockRequest::class, [$productId]);

        $page = BackInStockRequest::query()
            ->where('product_id', $productId)
            ->when($status === 'open', fn ($q) => $q->whereNull('notified_at'))
            ->when($status === 'notified', fn ($q) => $q->whereNotNull('notified_at'))
            ->orderByDesc('created_at')->orderByDesc('id')
            ->paginate($perPage);

        $labels = [];
        foreach ($product['variants'] as $variant) {
            $labels[$variant['id']] = CatalogReadModel::variantLabel($product['name'], $variant);
        }
        $missing = array_values(array_diff(array_unique(collect($page->items())->pluck('variant_id')->all()), array_keys($labels)));
        foreach ($this->products->variants($this->catalog->organizationId(), $missing) as $id => $info) {
            $labels[$id] = $info['variant_name'] ?? $info['sku'];
        }

        return [
            'page' => $page,
            'row' => fn (BackInStockRequest $r) => [
                'id' => $r->id,
                'variant_id' => $r->variant_id,
                'variant_label' => $labels[$r->variant_id] ?? null,
                'email' => $r->email,
                'locale' => $r->locale,
                'created_at' => $r->created_at?->toIso8601String(),
                'notified_at' => $r->notified_at?->toIso8601String(),
            ],
        ];
    }
}
