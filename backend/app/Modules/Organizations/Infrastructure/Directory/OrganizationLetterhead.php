<?php

namespace App\Modules\Organizations\Infrastructure\Directory;

use App\Modules\Organizations\Application\Contracts\OrganizationDirectory;
use App\Modules\Shared\Application\Contracts\DocumentLetterhead;

/**
 * The organization's profile and contact details as printed on generated documents.
 * No logo here: the Storefront module decorates this with the theme logo.
 */
class OrganizationLetterhead implements DocumentLetterhead
{
    public function __construct(private readonly OrganizationDirectory $organizations) {}

    public function forOrganization(string $organizationId): array
    {
        $summary = $this->organizations->summary($organizationId) ?? [];

        return [
            'name' => (string) ($summary['name'] ?? ''),
            'legal_name' => $summary['legal_name'] ?? null,
            'address' => $summary['address'] ?? null,
            'phone' => $summary['phone'] ?? null,
            'email' => $summary['email'] ?? null,
            'tax_number' => $summary['tax_number'] ?? null,
            'slug' => (string) ($summary['slug'] ?? ''),
            'timezone' => (string) ($summary['timezone'] ?? config('app.timezone')),
            'logo' => null,
        ];
    }
}
