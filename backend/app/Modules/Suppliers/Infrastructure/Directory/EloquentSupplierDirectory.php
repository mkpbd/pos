<?php

namespace App\Modules\Suppliers\Infrastructure\Directory;

use App\Modules\Suppliers\Application\Contracts\SupplierDirectory;
use App\Modules\Suppliers\Infrastructure\Models\Supplier;

class EloquentSupplierDirectory implements SupplierDirectory
{
    public function find(string $supplierId, string $organizationId): ?array
    {
        $supplier = Supplier::query()->withoutGlobalScope('organization')->withTrashed()
            ->where('organization_id', $organizationId)
            ->find($supplierId);

        return $supplier === null ? null : [
            'id' => $supplier->id,
            'code' => $supplier->code,
            'name' => $supplier->name,
            'is_active' => $supplier->is_active,
            'archived' => $supplier->trashed(),
            'opening_balance' => $supplier->opening_balance,
            'payment_terms_days' => $supplier->payment_terms_days,
        ];
    }

    public function summaries(string $organizationId, array $supplierIds): array
    {
        if ($supplierIds === []) {
            return [];
        }

        return Supplier::query()->withoutGlobalScope('organization')->withTrashed()
            ->where('organization_id', $organizationId)
            ->whereKey(array_values(array_unique($supplierIds)))
            ->get(['id', 'code', 'name'])
            ->mapWithKeys(fn (Supplier $s) => [$s->id => ['id' => $s->id, 'code' => $s->code, 'name' => $s->name]])
            ->all();
    }
}
