<?php

namespace App\Modules\Shared\Domain;

/**
 * P2a: where a shopper came from — the UTM parameters, the short link code, the first landing
 * path and the referring host the storefront remembered (last non-direct touch, 30 days) and
 * sends with a checkout or a visit. Sanitized, never rejected: unknown keys and invalid values
 * are dropped, texts trimmed and stripped of control characters; `utm_source`, `utm_medium`
 * and `utm_campaign` lower-cased so reports group them. Nothing personal is kept.
 */
final class CampaignAttribution
{
    public const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];

    /** Lower-cased UTM keys (grouped in reports). */
    public const LOWERCASE = ['utm_source', 'utm_medium', 'utm_campaign'];

    public const UTM_MAX = 100;

    public const CODE_PATTERN = '/^[a-z0-9-]{3,32}$/';

    public const PATH_MAX = 255;

    /**
     * The sanitized attribution, or null when nothing usable is left.
     *
     * @return array<string, string>|null
     */
    public static function sanitize(mixed $input): ?array
    {
        if (! is_array($input)) {
            return null;
        }
        $result = [];
        foreach (self::UTM_KEYS as $key) {
            $value = self::utm($input[$key] ?? null);
            if ($value !== null) {
                $result[$key] = in_array($key, self::LOWERCASE, true) ? mb_strtolower($value) : $value;
            }
        }
        if (($code = self::code($input['short_link'] ?? null)) !== null) {
            $result['short_link'] = $code;
        }
        if (($path = self::path($input['landing_path'] ?? null)) !== null) {
            $result['landing_path'] = $path;
        }
        if (($host = self::host($input['referrer_host'] ?? null)) !== null) {
            $result['referrer_host'] = $host;
        }
        $seen = $input['first_seen_at'] ?? null;
        if (is_string($seen) && strlen($seen) <= 40 && preg_match('/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:?\d{2})$/', $seen) === 1) {
            $result['first_seen_at'] = $seen;
        }

        return $result === [] ? null : $result;
    }

    /**
     * A UTM value: trimmed, control characters removed, at most 100 characters; null when empty.
     */
    public static function utm(mixed $value): ?string
    {
        if (! is_string($value) && ! is_int($value)) {
            return null;
        }
        $clean = trim((string) preg_replace('/[\p{Cc}\p{Cf}]+/u', '', (string) $value));
        if ($clean === '' || preg_match('//u', $clean) !== 1) {
            return null;
        }

        return mb_substr($clean, 0, self::UTM_MAX);
    }

    /**
     * A short link code (lower-cased), or null.
     */
    public static function code(mixed $value): ?string
    {
        if (! is_string($value)) {
            return null;
        }
        $code = mb_strtolower(trim($value));

        return preg_match(self::CODE_PATTERN, $code) === 1 ? $code : null;
    }

    /**
     * A store path: starts with one "/", no scheme, query or fragment (they are cut off), at most
     * 255 characters, printable; null otherwise.
     */
    public static function path(mixed $value): ?string
    {
        if (! is_string($value)) {
            return null;
        }
        $path = trim($value);
        $path = explode('#', explode('?', $path, 2)[0], 2)[0];
        if ($path === '' || $path[0] !== '/' || str_starts_with($path, '//') || str_contains($path, '\\')
            || mb_strlen($path) > self::PATH_MAX || preg_match('/[\p{Cc}\s]/u', $path) === 1 || preg_match('//u', $path) !== 1) {
            return null;
        }

        return $path;
    }

    /**
     * A host name (lower-cased, no port), or null.
     */
    public static function host(mixed $value): ?string
    {
        if (! is_string($value)) {
            return null;
        }
        $host = mb_strtolower(trim($value));
        if (str_contains($host, '://')) {
            $host = (string) parse_url($host, PHP_URL_HOST);
        }
        $host = explode(':', $host, 2)[0];

        return strlen($host) <= 255 && preg_match('/^(?=.{1,255}$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/', $host) === 1 ? $host : null;
    }
}
