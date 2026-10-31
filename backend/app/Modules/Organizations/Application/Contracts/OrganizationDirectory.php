<?php

namespace App\Modules\Organizations\Application\Contracts;

/**
 * Read access to organizations for other modules.
 */
interface OrganizationDirectory
{
    public function isActive(string $organizationId): bool;

    /**
     * @return array{id: string, name: string, slug: string, base_currency: string, timezone: string, tax_mode: string, status: string}|null
     */
    public function summary(string $organizationId): ?array;
}
