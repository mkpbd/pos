<?php

namespace App\Modules\Storefront\Infrastructure;

use App\Modules\Media\Application\Contracts\MediaLibrary;
use App\Modules\Shared\Application\Contracts\DocumentLetterhead;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Storefront\Application\Queries\StorefrontConfig;
use Throwable;

/**
 * Adds the storefront theme's logo (the one printed on packing slips and invoices) to the
 * organization letterhead of generated documents, as an embeddable data URI.
 */
class ThemeLogoLetterhead implements DocumentLetterhead
{
    public function __construct(
        private readonly DocumentLetterhead $inner,
        private readonly StorefrontConfig $storefront,
        private readonly MediaLibrary $media,
        private readonly TenantContext $tenant,
    ) {}

    public function forOrganization(string $organizationId): array
    {
        $letterhead = $this->inner->forOrganization($organizationId);
        if ($letterhead['logo'] !== null) {
            return $letterhead;
        }

        try {
            $letterhead['logo'] = $this->tenant->runAs($organizationId, function () {
                $logoId = $this->storefront->theme()->settings['logo_media_id'] ?? null;

                return is_string($logoId) && $logoId !== '' ? $this->media->dataUri($logoId) : null;
            }, $this->tenant->organizationId() === $organizationId ? $this->tenant->branchId() : null);
        } catch (Throwable) {
            // A missing or unreadable logo never blocks a document.
        }

        return $letterhead;
    }
}
