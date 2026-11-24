<?php

namespace App\Modules\System\Domain\Exceptions;

use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;

/**
 * G1b: only one backup (or one restore check) runs at a time.
 */
final class BackupRunning extends BusinessRuleViolation
{
    public static function backup(): self
    {
        return new self('BACKUP_RUNNING', 'A backup is already running. Wait for it to finish.', status: 409);
    }

    public static function verification(): self
    {
        return new self('BACKUP_VERIFY_RUNNING', 'A restore check is already running. Wait for it to finish.', status: 409);
    }
}
