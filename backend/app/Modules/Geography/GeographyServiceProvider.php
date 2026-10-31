<?php

namespace App\Modules\Geography;

use App\Modules\Geography\Application\Contracts\GeoDirectory;
use App\Modules\Geography\Infrastructure\DatabaseGeoDirectory;
use App\Modules\Shared\Infrastructure\Providers\ModuleServiceProvider;

/**
 * Global geographic reference data (Bangladesh divisions and districts) for addresses,
 * with public lookup endpoints for the storefront's address forms.
 */
class GeographyServiceProvider extends ModuleServiceProvider
{
    public function register(): void
    {
        $this->app->bind(GeoDirectory::class, DatabaseGeoDirectory::class);
    }
}
