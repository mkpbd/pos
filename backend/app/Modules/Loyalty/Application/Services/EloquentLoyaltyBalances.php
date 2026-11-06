<?php

namespace App\Modules\Loyalty\Application\Services;

use App\Modules\Loyalty\Application\Contracts\LoyaltyBalances;
use App\Modules\Loyalty\Infrastructure\Models\LoyaltyAccount;
use App\Modules\Loyalty\Infrastructure\Models\LoyaltySettings;

class EloquentLoyaltyBalances implements LoyaltyBalances
{
    public function program(string $organizationId): array
    {
        $settings = LoyaltySettings::query()->withoutGlobalScope('organization')->where('organization_id', $organizationId)->first();

        return [
            'enabled' => (bool) ($settings?->is_enabled ?? false),
            'point_value' => (string) ($settings?->point_value ?? '1.00'),
        ];
    }

    public function balances(string $organizationId, array $customerIds): array
    {
        $balances = [];
        foreach (array_chunk(array_values(array_unique($customerIds)), 500) as $chunk) {
            $balances += LoyaltyAccount::query()->withoutGlobalScope('organization')
                ->where('organization_id', $organizationId)
                ->whereIn('customer_id', $chunk)
                ->pluck('balance', 'customer_id')
                ->map(fn ($balance) => (int) $balance)
                ->all();
        }

        return $balances;
    }
}
