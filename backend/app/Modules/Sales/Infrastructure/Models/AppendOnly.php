<?php

namespace App\Modules\Sales\Infrastructure\Models;

use LogicException;

/**
 * Model guard mirroring the PostgreSQL append-only triggers on sales detail tables.
 */
trait AppendOnly
{
    protected static function bootAppendOnly(): void
    {
        static::updating(fn () => throw new LogicException(class_basename(static::class).' rows are append-only.'));
        static::deleting(fn () => throw new LogicException(class_basename(static::class).' rows are append-only.'));
    }
}
