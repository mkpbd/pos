<?php

namespace App\Modules\Inventory\Presentation\Http\Support;

use App\Modules\Branches\Application\Contracts\BranchDirectory;
use App\Modules\Inventory\Infrastructure\Models\Batch;
use App\Modules\Products\Application\Contracts\ProductDirectory;
use App\Modules\Shared\Application\Contracts\TenantUser;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use Illuminate\Database\Eloquent\Builder as EloquentBuilder;
use Illuminate\Database\Query\Builder as QueryBuilder;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

/**
 * Shared helpers for inventory read endpoints: branch scoping and display data
 * (variant, store, batch labels) fetched once per page through the owning modules.
 */
class InventoryPresenter
{
    public function __construct(
        private readonly TenantContext $tenant,
        private readonly ProductDirectory $products,
        private readonly BranchDirectory $branches,
    ) {}

    /**
     * Restricts a query to branches the user may access, optionally narrowed to one branch.
     */
    public function scopeBranches(EloquentBuilder|QueryBuilder $query, TenantUser $user, ?string $branchId, string $column = 'branch_id'): void
    {
        $accessible = $user->accessibleBranchIds();

        if ($branchId !== null) {
            if ($accessible !== null && ! in_array($branchId, $accessible, true)) {
                throw new NotFoundHttpException;
            }
            $query->where($column, $branchId);
        } elseif ($accessible !== null) {
            $query->whereIn($column, $accessible);
        }
    }

    /**
     * @param  list<string>  $variantIds
     * @param  list<string>  $storeIds
     * @param  list<string>  $batchIds
     * @return array{variants: array<string, array<string, mixed>>, stores: array<string, array<string, mixed>>, batches: array<string, array<string, mixed>>}
     */
    public function lookups(array $variantIds = [], array $storeIds = [], array $batchIds = []): array
    {
        $organizationId = $this->tenant->requireOrganization();
        $batchIds = array_values(array_unique(array_filter($batchIds)));

        return [
            'variants' => $this->products->variants($organizationId, array_values(array_unique($variantIds))),
            'stores' => $this->branches->storeSummaries($organizationId, $storeIds),
            'batches' => $batchIds === [] ? [] : Batch::query()->whereKey($batchIds)->get()->mapWithKeys(fn (Batch $b) => [$b->id => [
                'id' => $b->id,
                'batch_number' => $b->batch_number,
                'expires_on' => $b->expires_on?->toDateString(),
            ]])->all(),
        ];
    }

    /**
     * @param  array<string, mixed>|null  $variant
     * @return array<string, mixed>|null
     */
    public static function variant(?array $variant): ?array
    {
        return $variant === null ? null : [
            'id' => $variant['variant_id'],
            'product_id' => $variant['product_id'],
            'product_name' => $variant['product_name'],
            'variant_name' => $variant['variant_name'],
            'sku' => $variant['sku'],
            'unit_code' => $variant['unit_code'],
            'track_batches' => $variant['track_batches'],
            'allow_decimal' => $variant['allow_decimal'],
        ];
    }
}
