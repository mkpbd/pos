<?php

namespace App\Modules\Users\Infrastructure\Console;

use App\Modules\Organizations\Infrastructure\Models\Organization;
use App\Modules\Users\Application\Actions\ProvisionSystemRoles;
use App\Modules\Users\Application\Actions\SyncPermissionCatalog;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

class SyncPermissionsCommand extends Command
{
    protected $signature = 'pos:permissions:sync';

    protected $description = 'Sync the permission catalog from code and refresh built-in roles of every organization';

    public function handle(SyncPermissionCatalog $syncCatalog, ProvisionSystemRoles $provisionRoles): int
    {
        DB::transaction(function () use ($syncCatalog, $provisionRoles) {
            $result = $syncCatalog();
            $this->components->info("Permission catalog synced ({$result['added']} added, {$result['removed']} removed).");

            Organization::query()->lazyById()->each(fn (Organization $org) => $provisionRoles($org->id));
            $this->components->info('Built-in roles refreshed.');
        });

        return self::SUCCESS;
    }
}
