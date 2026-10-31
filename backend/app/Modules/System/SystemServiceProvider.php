<?php

namespace App\Modules\System;

use App\Modules\Shared\Infrastructure\Providers\ModuleServiceProvider;

/**
 * Operational endpoints (health, version) used by load balancers,
 * monitoring and the frontend status page.
 */
class SystemServiceProvider extends ModuleServiceProvider {}
