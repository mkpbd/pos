<?php

namespace App\Modules\Shared\Application\Support;

use Carbon\CarbonImmutable;

/**
 * Timestamps arrive as ISO 8601 with the sender's offset ("2026-11-03T00:00:00+06:00").
 * Eloquent stores a date's wall-clock time without its offset, so moments are moved to
 * the application timezone first; otherwise the stored instant would shift by the offset.
 */
final class Instants
{
    /**
     * @param  array<string, mixed>  $attributes
     * @param  list<string>  $keys
     * @return array<string, mixed>
     */
    public static function normalize(array $attributes, array $keys): array
    {
        foreach ($keys as $key) {
            if (isset($attributes[$key]) && is_string($attributes[$key])) {
                $attributes[$key] = CarbonImmutable::parse($attributes[$key])->setTimezone((string) config('app.timezone'));
            }
        }

        return $attributes;
    }
}
