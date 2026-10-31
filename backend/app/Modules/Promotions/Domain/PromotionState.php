<?php

namespace App\Modules\Promotions\Domain;

use DateTimeInterface;

/**
 * Where a promotion stands for the admin list: switched off, waiting for its start,
 * running, or past its end.
 */
enum PromotionState: string
{
    case Active = 'active';
    case Scheduled = 'scheduled';
    case Expired = 'expired';
    case Inactive = 'inactive';

    public static function of(bool $isActive, ?DateTimeInterface $startsAt, ?DateTimeInterface $endsAt, DateTimeInterface $now): self
    {
        return match (true) {
            ! $isActive => self::Inactive,
            $endsAt !== null && $endsAt <= $now => self::Expired,
            $startsAt !== null && $startsAt > $now => self::Scheduled,
            default => self::Active,
        };
    }
}
