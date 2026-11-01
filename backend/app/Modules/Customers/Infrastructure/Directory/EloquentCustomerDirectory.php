<?php

namespace App\Modules\Customers\Infrastructure\Directory;

use App\Modules\Customers\Application\Contracts\CustomerDirectory;
use App\Modules\Customers\Infrastructure\Models\Customer;

class EloquentCustomerDirectory implements CustomerDirectory
{
    public function find(string $customerId, string $organizationId): ?array
    {
        $customer = Customer::query()->withoutGlobalScope('organization')->withTrashed()
            ->where('organization_id', $organizationId)
            ->with(['group' => fn ($q) => $q->withoutGlobalScope('organization')])
            ->find($customerId);

        return $customer === null ? null : [
            'id' => $customer->id,
            'code' => $customer->code,
            'name' => $customer->name,
            'phone' => $customer->phone,
            'is_active' => $customer->is_active,
            'archived' => $customer->trashed(),
            'credit_limit' => $customer->credit_limit,
            'opening_balance' => $customer->opening_balance,
            'group_discount_percent' => $customer->group?->discount_percent ?? '0.00',
        ];
    }

    public function summaries(string $organizationId, array $customerIds): array
    {
        if ($customerIds === []) {
            return [];
        }

        return Customer::query()->withoutGlobalScope('organization')->withTrashed()
            ->where('organization_id', $organizationId)
            ->whereKey(array_values(array_unique($customerIds)))
            ->get(['id', 'code', 'name', 'phone', 'email'])
            ->mapWithKeys(fn (Customer $c) => [$c->id => ['id' => $c->id, 'code' => $c->code, 'name' => $c->name, 'phone' => $c->phone, 'email' => $c->email]])
            ->all();
    }

    public function openingBalances(string $organizationId, array $customerIds): array
    {
        if ($customerIds === []) {
            return [];
        }

        return Customer::query()->withoutGlobalScope('organization')->withTrashed()
            ->where('organization_id', $organizationId)
            ->whereKey(array_values(array_unique($customerIds)))
            ->pluck('opening_balance', 'id')
            ->map(fn ($balance) => (string) $balance)
            ->all();
    }
}
