<?php

namespace App\Modules\Shared\Application\Authorization;

/**
 * In-memory catalog of every permission declared by the modules.
 *
 * Modules declare permissions in their ServiceProvider (see ModuleServiceProvider::permissions());
 * `php artisan pos:permissions:sync` mirrors the catalog into the permissions table.
 */
final class PermissionRegistry
{
    /** @var array<string, array{module: string, description: string}> */
    private array $permissions = [];

    /**
     * @param  array<string, string>  $permissions  name => description
     */
    public function register(string $module, array $permissions): void
    {
        foreach ($permissions as $name => $description) {
            $this->permissions[$name] = ['module' => $module, 'description' => $description];
        }
    }

    public function has(string $name): bool
    {
        return isset($this->permissions[$name]);
    }

    /**
     * @return array<string, array{module: string, description: string}>
     */
    public function all(): array
    {
        ksort($this->permissions);

        return $this->permissions;
    }

    /**
     * Names matching any of the glob patterns ("*", "users.*", "sales.view").
     *
     * @param  list<string>  $patterns
     * @return list<string>
     */
    public function matching(array $patterns): array
    {
        return array_values(array_filter(
            array_keys($this->all()),
            fn (string $name) => array_any($patterns, fn (string $pattern) => fnmatch($pattern, $name)),
        ));
    }
}
