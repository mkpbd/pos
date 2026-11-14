<?php

namespace App\Modules\Products\Application\Services;

use App\Modules\Products\Application\Contracts\VariantStock;
use App\Modules\Shared\Application\Contracts\TenantUser;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;

/**
 * Used when no inventory module is installed: no stock, no history, no stock postings.
 */
class NoVariantStock implements VariantStock
{
    public function levels(TenantUser $user, array $variantIds): ?array
    {
        return null;
    }

    public function withHistory(string $organizationId, array $variantIds): array
    {
        return [];
    }

    public function postOpening(TenantUser $actor, string $storeId, array $quantities, string $note): string
    {
        throw new BusinessRuleViolation('INVENTORY_UNAVAILABLE', 'Stock cannot be recorded here.');
    }
}
