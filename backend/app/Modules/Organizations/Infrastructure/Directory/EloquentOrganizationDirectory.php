<?php

namespace App\Modules\Organizations\Infrastructure\Directory;

use App\Modules\Organizations\Application\Contracts\OrganizationDirectory;
use App\Modules\Organizations\Domain\Enums\OrganizationStatus;
use App\Modules\Organizations\Infrastructure\Models\Organization;

class EloquentOrganizationDirectory implements OrganizationDirectory
{
    public function isActive(string $organizationId): bool
    {
        return Organization::query()->find($organizationId)?->isActive() ?? false;
    }

    public function activeIds(): array
    {
        return Organization::query()->where('status', OrganizationStatus::Active->value)->orderBy('created_at')->orderBy('id')->pluck('id')->all();
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
            'invoice_prefix' => $organization->settings['invoice_prefix'] ?? null,
            'receipt_header' => $organization->settings['receipt_header'] ?? null,
            'receipt_footer' => $organization->settings['receipt_footer'] ?? null,
            'legal_name' => $organization->getAttribute('legal_name'),
            'tax_number' => $organization->getAttribute('tax_number'),
            'email' => $organization->getAttribute('email'),
            'phone' => $organization->getAttribute('phone'),
            'address' => $organization->getAttribute('address'),
        ];
    }
}
