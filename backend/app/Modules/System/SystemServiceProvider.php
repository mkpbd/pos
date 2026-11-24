<?php

namespace App\Modules\System;

use App\Modules\Shared\Infrastructure\Providers\ModuleServiceProvider;
use App\Modules\System\Infrastructure\Console\BackupCommand;
use App\Modules\System\Infrastructure\Console\HeartbeatCommand;
use App\Modules\System\Infrastructure\Console\PruneRecordsCommand;
use App\Modules\System\Infrastructure\Console\VerifyBackupCommand;
use App\Modules\System\Infrastructure\ErrorLog\ErrorRecorder;

/**
 * Operational endpoints (health, version) used by load balancers, monitoring and the frontend
 * status page; G1b: operations for platform admins — system status with scheduler / queue
 * heartbeats, database backups and restore checks, the built-in error log, failed queue jobs
 * and data retention.
 */
class SystemServiceProvider extends ModuleServiceProvider
{
    public function register(): void
    {
        // G1b: the error log writes through its own connection (a copy of the default one), so a
        // request's rolled-back transaction never takes the recorded error with it.
        $default = (string) config('database.default');
        if (config('database.connections.'.ErrorRecorder::CONNECTION) === null && is_array($config = config("database.connections.{$default}"))) {
            config(['database.connections.'.ErrorRecorder::CONNECTION => $config]);
        }
    }

    public function boot(): void
    {
        parent::boot();

        if ($this->app->runningInConsole()) {
            $this->commands([HeartbeatCommand::class, BackupCommand::class, VerifyBackupCommand::class, PruneRecordsCommand::class]);
        }
    }
}
