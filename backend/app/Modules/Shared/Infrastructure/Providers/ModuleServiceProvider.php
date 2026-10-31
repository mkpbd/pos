<?php

namespace App\Modules\Shared\Infrastructure\Providers;

use App\Modules\Shared\Application\Authorization\PermissionRegistry;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\ServiceProvider;
use ReflectionClass;

/**
 * Base provider for every business module.
 *
 * Convention over configuration: a module that ships
 *   Presentation/Routes/api.php            -> mounted under /api/v1 with the "api" middleware group
 *   Presentation/Routes/web.php            -> mounted with the "web" middleware group (HTML pages)
 *   Infrastructure/Database/Migrations/    -> registered with the migrator
 * gets both wired automatically. Permissions returned by permissions() are added to the
 * PermissionRegistry. Modules bind their own contracts in register().
 */
abstract class ModuleServiceProvider extends ServiceProvider
{
    public function boot(): void
    {
        $path = $this->modulePath();

        if (is_dir($migrations = $path.'/Infrastructure/Database/Migrations')) {
            $this->loadMigrationsFrom($migrations);
        }

        if (is_file($routes = $path.'/Presentation/Routes/api.php') && ! $this->app->routesAreCached()) {
            Route::prefix('api/v1')->middleware('api')->group($routes);
        }

        if (is_file($routes = $path.'/Presentation/Routes/web.php') && ! $this->app->routesAreCached()) {
            Route::middleware('web')->group($routes);
        }

        if ($permissions = $this->permissions()) {
            $this->app->make(PermissionRegistry::class)->register($this->moduleName(), $permissions);
        }
    }

    /**
     * Permissions this module declares, as name => description.
     *
     * @return array<string, string>
     */
    protected function permissions(): array
    {
        return [];
    }

    protected function moduleName(): string
    {
        return basename($this->modulePath());
    }

    protected function modulePath(): string
    {
        return dirname((string) (new ReflectionClass($this))->getFileName());
    }
}
