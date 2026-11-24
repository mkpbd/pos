<?php

namespace App\Modules\Imports;

use App\Modules\Imports\Infrastructure\Retention\PruneImportFiles;
use App\Modules\Shared\Application\Contracts\RetentionTask;
use App\Modules\Shared\Infrastructure\Providers\ModuleServiceProvider;

/**
 * ST1: bulk import from Excel / CSV. Owns the `imports` history, the upload, file reading, the
 * queued dry run and run, and the errors file. The importable types are handlers implemented
 * by the modules that own the records (Imports\Application\Contracts\ImportHandler, tagged
 * ImportHandler::TAG): products and price updates (Products), opening stock (Inventory),
 * customers (Customers), suppliers (Suppliers). Each type uses its owner's permission, so this
 * module declares none.
 */
class ImportsServiceProvider extends ModuleServiceProvider
{
    public function register(): void
    {
        $this->app->tag([PruneImportFiles::class], RetentionTask::TAG);
    }
}
