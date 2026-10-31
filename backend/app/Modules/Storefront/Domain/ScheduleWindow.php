<?php

namespace App\Modules\Storefront\Domain;

use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use DateTimeInterface;

/**
 * Optional start/end of a banner's or section's visibility. Either end may be open.
 */
final class ScheduleWindow
{
    public static function assertValid(?DateTimeInterface $startsAt, ?DateTimeInterface $endsAt): void
    {
        if ($startsAt !== null && $endsAt !== null && $endsAt <= $startsAt) {
            throw new BusinessRuleViolation('SCHEDULE_INVALID', 'The end of the schedule must be after its start.');
        }
    }
}
