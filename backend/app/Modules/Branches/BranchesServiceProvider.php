<?php

namespace App\Modules\Branches;

use App\Modules\Branches\Application\Contracts\BranchDirectory;
use App\Modules\Branches\Infrastructure\Directory\EloquentBranchDirectory;
use App\Modules\Shared\Infrastructure\Providers\ModuleServiceProvider;

/**
 * Branches and their stock locations (stores / warehouses).
 */
class BranchesServiceProvider extends ModuleServiceProvider
{
    public function register(): void
    {
        $this->app->bind(BranchDirectory::class, EloquentBranchDirectory::class);
    }

    protected function permissions(): array
    {
        return [
            'branches.view' => 'View branches and their stores',
            'branches.manage' => 'Create and edit branches and stores',
            'branches.access_all' => 'Work in every branch without being assigned to it',
        ];
    }
}
