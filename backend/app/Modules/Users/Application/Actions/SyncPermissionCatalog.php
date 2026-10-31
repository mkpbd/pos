<?php

namespace App\Modules\Users\Application\Actions;

use App\Modules\Shared\Application\Authorization\PermissionRegistry;
use App\Modules\Users\Infrastructure\Models\Permission;

/**
 * Mirrors the code-declared permission catalog into the permissions table.
 * Permissions no longer declared are removed (and with them their role grants).
 */
class SyncPermissionCatalog
{
    public function __construct(private readonly PermissionRegistry $registry) {}

    /**
     * @return array{added: int, removed: int}
     */
    public function __invoke(): array
    {
        $declared = $this->registry->all();
        $existing = Permission::query()->pluck('name')->all();

        $rows = [];
        foreach ($declared as $name => $meta) {
            $rows[] = ['name' => $name, 'module' => $meta['module'], 'description' => $meta['description']];
        }
        if ($rows !== []) {
            Permission::query()->upsert($rows, ['name'], ['module', 'description']);
        }

        $stale = array_values(array_diff($existing, array_keys($declared)));
        if ($stale !== []) {
            Permission::query()->whereKey($stale)->delete();
        }

        return [
            'added' => count(array_diff(array_keys($declared), $existing)),
            'removed' => count($stale),
        ];
    }
}
