<?php

namespace App\Modules\Audit;

use App\Modules\Audit\Infrastructure\Services\DatabaseAuditTrail;
use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Infrastructure\Providers\ModuleServiceProvider;

/**
 * Append-only audit trail of sensitive operations.
 */
class AuditServiceProvider extends ModuleServiceProvider
{
    public function register(): void
    {
        $this->app->bind(AuditTrail::class, DatabaseAuditTrail::class);
    }

    protected function permissions(): array
    {
        return [
            'audit.view' => 'View the audit trail and login activity of the organization',
        ];
    }
}
