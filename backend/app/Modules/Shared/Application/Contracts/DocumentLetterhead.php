<?php

namespace App\Modules\Shared\Application\Contracts;

/**
 * The organization details printed at the top of generated documents (list exports):
 * names, contact details, tax number, timezone and an embeddable logo (data URI) when one
 * is set. Implemented by the Organizations module; the Storefront module adds the theme logo.
 */
interface DocumentLetterhead
{
    /**
     * @return array{name: string, legal_name: ?string, address: ?string, phone: ?string, email: ?string, tax_number: ?string, slug: string, timezone: string, logo: ?string}
     */
    public function forOrganization(string $organizationId): array;
}
