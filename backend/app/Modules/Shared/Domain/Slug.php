<?php

namespace App\Modules\Shared\Domain;

use Illuminate\Support\Str;

/**
 * Web address segments: lower-case ASCII letters and digits separated by single hyphens.
 * Suggestions come from a name and are de-duplicated with "-2", "-3", … suffixes.
 */
final class Slug
{
    public const PATTERN = '/^[a-z0-9]+(?:-[a-z0-9]+)*$/';

    public static function isValid(string $slug, int $maxLength = 120): bool
    {
        return $slug !== '' && strlen($slug) <= $maxLength && preg_match(self::PATTERN, $slug) === 1;
    }

    /**
     * The slug for a name that no record uses yet.
     *
     * @param  callable(string): bool  $taken  whether a candidate is already used
     */
    public static function suggest(string $name, callable $taken, int $maxLength = 120, string $fallback = 'item'): string
    {
        $base = self::fromName($name, $maxLength) ?: $fallback;
        $candidate = $base;
        for ($n = 2; $taken($candidate); $n++) {
            $suffix = '-'.$n;
            $candidate = rtrim(substr($base, 0, $maxLength - strlen($suffix)), '-').$suffix;
        }

        return $candidate;
    }

    /**
     * Str::slug of the name, cut at the length limit without a trailing hyphen.
     */
    public static function fromName(string $name, int $maxLength = 120): string
    {
        return trim(substr(Str::slug($name), 0, $maxLength), '-');
    }
}
