<?php

namespace App\Modules\Branches\Infrastructure\Directory;

use App\Modules\Branches\Application\Contracts\BranchDirectory;
use App\Modules\Branches\Infrastructure\Models\Branch;
use App\Modules\Branches\Infrastructure\Models\Store;
use Illuminate\Database\Eloquent\Builder;

class EloquentBranchDirectory implements BranchDirectory
{
    public function isActiveBranchOf(string $branchId, string $organizationId): bool
    {
        return $this->query($organizationId)
            ->whereKey($branchId)
            ->where('is_active', true)
            ->exists();
    }

    public function filterOwned(array $branchIds, string $organizationId): array
    {
        if ($branchIds === []) {
            return [];
        }

        return $this->query($organizationId)->whereKey($branchIds)->pluck('id')->all();
    }

    public function summaries(string $organizationId, ?array $branchIds = null): array
    {
        return $this->query($organizationId)
            ->when($branchIds !== null, fn (Builder $q) => $q->whereKey($branchIds))
            ->orderBy('name')
            ->get(['id', 'code', 'name', 'is_active'])
            ->map(fn (Branch $b) => ['id' => $b->id, 'code' => $b->code, 'name' => $b->name, 'is_active' => $b->is_active])
            ->all();
    }

    public function store(string $storeId, string $organizationId): ?array
    {
        $store = Store::query()->withoutGlobalScope('organization')
            ->where('organization_id', $organizationId)
            ->with(['branch' => fn ($q) => $q->withoutGlobalScope('organization')])
            ->find($storeId);

        return $store === null ? null : [
            'id' => $store->id,
            'code' => $store->code,
            'name' => $store->name,
            'branch_id' => $store->branch_id,
            'branch_name' => $store->branch->name,
            'is_active' => $store->is_active,
            'branch_is_active' => $store->branch->is_active,
            'allow_negative_stock' => $store->branch->allow_negative_stock,
        ];
    }

    public function storeSummaries(string $organizationId, array $storeIds): array
    {
        if ($storeIds === []) {
            return [];
        }

        return Store::query()->withoutGlobalScope('organization')
            ->where('organization_id', $organizationId)
            ->whereKey(array_values(array_unique($storeIds)))
            ->with(['branch' => fn ($q) => $q->withoutGlobalScope('organization')])
            ->get()
            ->mapWithKeys(fn (Store $s) => [$s->id => [
                'id' => $s->id,
                'code' => $s->code,
                'name' => $s->name,
                'branch_id' => $s->branch_id,
                'branch_name' => $s->branch->name,
            ]])
            ->all();
    }

    /**
     * Explicit organization filter: callers may run before the tenant context is resolved.
     *
     * @return Builder<Branch>
     */
    private function query(string $organizationId): Builder
    {
        return Branch::query()->withoutGlobalScope('organization')->where('organization_id', $organizationId);
    }
}
