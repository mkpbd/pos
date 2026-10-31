<?php

namespace App\Modules\Shared\Application\Support;

/**
 * Before/after diff of attribute snapshots, used for audit entries.
 */
final class Changes
{
    /**
     * @param  array<string, mixed>  $before
     * @param  array<string, mixed>  $after
     * @return array{0: array<string, mixed>, 1: array<string, mixed>} [old values, new values] of changed keys only
     */
    public static function between(array $before, array $after): array
    {
        $keys = array_keys(array_filter(
            $before + $after,
            fn ($_, $key) => ($before[$key] ?? null) !== ($after[$key] ?? null),
            ARRAY_FILTER_USE_BOTH,
        ));

        return [
            array_intersect_key($before, array_flip($keys)),
            array_intersect_key($after, array_flip($keys)),
        ];
    }
}
