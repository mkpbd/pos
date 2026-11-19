<?php

namespace App\Modules\Marketing\Application\Support;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Str;

/**
 * P2a / B15: a visitor's hash for one day without personal data — sha256 of a random salt that
 * only exists for that day (in the cache, gone after two days), the ip and the user agent.
 * Neither the address nor the browser can be recovered from it, and hashes of different days
 * cannot be linked. Only used to count a day's unique visitors; the hashes are deleted after
 * two days (marketing:prune-visitor-hashes, marketing:prune-page-insights).
 */
final class DailyVisitorHash
{
    public static function of(string $day, ?string $ip, ?string $userAgent): string
    {
        $salt = Cache::remember('marketing:visit-salt:'.$day, now()->addDays(2), fn () => Str::random(40));

        return hash('sha256', $salt.'|'.($ip ?? '').'|'.($userAgent ?? ''));
    }
}
