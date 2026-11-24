<?php

namespace App\Modules\System\Domain\Status;

use DateTimeInterface;

/**
 * G1b: when the scheduler, the queue worker and the backups count as healthy.
 */
final class HealthRules
{
    /** The scheduler beats every minute; three missed beats make it stale. */
    public const SCHEDULER_STALE_AFTER_SECONDS = 180;

    /** The queue beat is a job the scheduler dispatches every minute; five minutes without it = stale. */
    public const QUEUE_STALE_AFTER_SECONDS = 300;

    /** A daily backup older than this is overdue. */
    public const BACKUP_STALE_AFTER_HOURS = 26;

    /** Restore checks older than this no longer count. */
    public const VERIFY_STALE_AFTER_DAYS = 8;

    /** Free space below this share of the backup volume is low. */
    public const DISK_LOW_RATIO = 0.10;

    /**
     * @return 'ok'|'stale'|'unknown'
     */
    public static function scheduler(?DateTimeInterface $lastBeat, DateTimeInterface $now): string
    {
        if ($lastBeat === null) {
            return 'unknown';
        }

        return $now->getTimestamp() - $lastBeat->getTimestamp() <= self::SCHEDULER_STALE_AFTER_SECONDS ? 'ok' : 'stale';
    }

    /**
     * @return 'ok'|'stale'|'unknown'|'sync'
     */
    public static function queue(string $driver, ?DateTimeInterface $lastBeat, DateTimeInterface $now): string
    {
        if ($driver === 'sync') {
            return 'sync';
        }
        if ($lastBeat === null) {
            return 'unknown';
        }

        return $now->getTimestamp() - $lastBeat->getTimestamp() <= self::QUEUE_STALE_AFTER_SECONDS ? 'ok' : 'stale';
    }

    public static function backupIsStale(?DateTimeInterface $lastSuccess, DateTimeInterface $now): bool
    {
        return $lastSuccess === null
            || $now->getTimestamp() - $lastSuccess->getTimestamp() > self::BACKUP_STALE_AFTER_HOURS * 3600;
    }

    public static function verificationIsStale(?DateTimeInterface $lastVerified, DateTimeInterface $now): bool
    {
        return $lastVerified === null
            || $now->getTimestamp() - $lastVerified->getTimestamp() > self::VERIFY_STALE_AFTER_DAYS * 86400;
    }

    public static function diskIsLow(?float $free, ?float $total): bool
    {
        return $free !== null && $total !== null && $total > 0 && $free / $total < self::DISK_LOW_RATIO;
    }
}
