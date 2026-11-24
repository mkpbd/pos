<?php

namespace App\Modules\Imports\Domain;

/**
 * validating → validated → importing → completed; failed when a step breaks; cancelled before the run.
 */
enum ImportStatus: string
{
    case Validating = 'validating';
    case Validated = 'validated';
    case Importing = 'importing';
    case Completed = 'completed';
    case Failed = 'failed';
    case Cancelled = 'cancelled';

    public function isFinished(): bool
    {
        return in_array($this, [self::Completed, self::Failed, self::Cancelled], true);
    }

    public function canCancel(): bool
    {
        return in_array($this, [self::Validating, self::Validated], true);
    }
}
