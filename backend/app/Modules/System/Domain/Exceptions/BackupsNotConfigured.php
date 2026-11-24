<?php

namespace App\Modules\System\Domain\Exceptions;

use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;

/**
 * G1b: backups use pg_dump, so they need the PostgreSQL driver.
 */
final class BackupsNotConfigured extends BusinessRuleViolation
{
    public function __construct()
    {
        parent::__construct('BACKUPS_NOT_CONFIGURED', 'Backups need a PostgreSQL database (pg_dump); the default connection uses another driver.');
    }
}
