<?php

namespace App\Modules\Storefront\Application\Queries;

use App\Modules\Organizations\Application\Contracts\OrganizationDirectory;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Storefront\Domain\ThemeSchema;
use App\Modules\Storefront\Infrastructure\Models\StorefrontSettings;
use App\Modules\Storefront\Infrastructure\Models\ThemeSettings;

/**
 * The current organization's storefront settings and theme. Organizations that never
 * saved them get defaults (a disabled store named after the organization, default theme)
 * as unsaved models, so readers never deal with missing rows.
 */
class StorefrontConfig
{
    public function __construct(
        private readonly TenantContext $tenant,
        private readonly OrganizationDirectory $organizations,
    ) {}

    public function settings(): StorefrontSettings
    {
        return StorefrontSettings::query()->first() ?? new StorefrontSettings([
            'is_enabled' => false,
            'site_name' => $this->organizations->summary($this->tenant->requireOrganization())['name'] ?? '',
            'meta_description' => null,
        ]);
    }

    public function theme(): ThemeSettings
    {
        $theme = ThemeSettings::query()->first() ?? new ThemeSettings(['custom_css' => null]);
        $theme->settings = ThemeSchema::normalize($theme->settings ?? []);

        return $theme;
    }
}
