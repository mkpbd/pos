<?php

namespace App\Modules\Organizations;

use App\Modules\Organizations\Application\Contracts\OrganizationDirectory;
use App\Modules\Organizations\Infrastructure\Directory\EloquentOrganizationDirectory;
use App\Modules\Shared\Infrastructure\Providers\ModuleServiceProvider;

/**
 * Organizations (tenants), tenant resolution and platform administration.
 */
class OrganizationsServiceProvider extends ModuleServiceProvider
{
    public function register(): void
    {
        $this->app->bind(OrganizationDirectory::class, EloquentOrganizationDirectory::class);
    }

    protected function permissions(): array
    {
        return [
            'organization.view' => 'View organization profile and settings',
            'organization.update' => 'Edit organization profile, tax mode and receipt settings',
        ];
    }
}
