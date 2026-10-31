<?php

namespace App\Modules\Organizations\Infrastructure\Directory;

use App\Modules\Organizations\Application\Contracts\OrganizationDirectory;
use App\Modules\Organizations\Infrastructure\Models\Organization;

class EloquentOrganizationDirectory implements OrganizationDirectory
{
    public function isActive(string $organizationId): bool
    {
        return Organization::query()->find($organizationId)?->isActive() ?? false;
    }

    public function summary(string $organizationId): ?array
    {
        $organization = Organization::query()->find($organizationId);

        return $organization === null ? null : [
            'id' => $organization->id,
            'name' => $organization->name,
            'slug' => $organization->slug,
            'base_currency' => $organization->base_currency,
            'timezone' => $organization->timezone,
            'tax_mode' => $organization->tax_mode->value,
            'status' => $organization->status->value,
        ];
    }
}
