<?php

namespace App\Modules\Users;

use App\Modules\Shared\Application\Authorization\PermissionRegistry;
use App\Modules\Shared\Infrastructure\Providers\ModuleServiceProvider;
use App\Modules\Users\Infrastructure\Console\SyncPermissionsCommand;
use App\Modules\Users\Infrastructure\Models\User;
use Illuminate\Support\Facades\Gate;

/**
 * Users, roles, permissions and branch membership.
 */
class UsersServiceProvider extends ModuleServiceProvider
{
    public function boot(): void
    {
        parent::boot();

        // Every catalog permission is a Gate ability: `can:users.manage`, $user->can('sales.void').
        // Platform admins pass every check; unknown abilities fall through to policies.
        Gate::before(function ($user, string $ability) {
            if (! $user instanceof User) {
                return null;
            }

            if ($user->isPlatformAdmin()) {
                return true;
            }

            return $this->app->make(PermissionRegistry::class)->has($ability) && $user->hasPermission($ability)
                ? true
                : null;
        });

        if ($this->app->runningInConsole()) {
            $this->commands([SyncPermissionsCommand::class]);
        }
    }

    protected function permissions(): array
    {
        return [
            'users.view' => 'View users',
            'users.manage' => 'Create users, edit them, assign roles and branches, deactivate',
            'roles.view' => 'View roles and permissions',
            'roles.manage' => 'Create, edit and delete custom roles',
        ];
    }
}
