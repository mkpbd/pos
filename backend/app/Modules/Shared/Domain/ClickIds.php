<?php

namespace App\Modules\Shared\Domain;

/**
 * BD1c: the ad click ids a shop or landing-page order keeps for the Conversions API —
 * `{fbp, fbc, ttp, ttclid, gclid}` from the browser's first-party cookies (`_fbp`, `_fbc` set by
 * the Meta pixel, `_ttp` by the TikTok pixel) and the attribution the storefront sends
 * (`fbclid` / `ttclid` / `gclid`, as keys of `attribution` or in the query of its
 * `landing_path`). Without an `_fbc` cookie a `fbclid` becomes `fb.1.<ms>.<fbclid>` (Meta's
 * format, <ms> the time it is first seen). Values are printable tokens of at most 200
 * characters; anything else is dropped, never an error. Null when nothing is left.
 */
final class ClickIds
{
    public const MAX = 200;

    private const TOKEN = '/^[A-Za-z0-9._~-]{1,200}$/';

    private const COOKIES = ['fbp' => '_fbp', 'fbc' => '_fbc', 'ttp' => '_ttp'];

    private const PARAMETERS = ['fbclid', 'ttclid', 'gclid'];

    /**
     * @param  array<string, mixed>  $cookies  the request's cookies (name => value)
     * @param  mixed  $attribution  the raw `attribution` body field
     * @param  int  $nowMs  the current time in milliseconds (for a built `fbc`)
     * @return array<string, string>|null
     */
    public static function collect(array $cookies, mixed $attribution, int $nowMs): ?array
    {
        $ids = [];
        foreach (self::COOKIES as $key => $cookie) {
            if (($value = self::token($cookies[$cookie] ?? null)) !== null) {
                $ids[$key] = $value;
            }
        }

        $clicks = [];
        if (is_array($attribution)) {
            $landing = $attribution['landing_path'] ?? null;
            if (is_string($landing) && strlen($landing) <= 2048 && str_contains($landing, '?')) {
                parse_str((string) parse_url('http://x'.(str_starts_with($landing, '/') ? '' : '/').$landing, PHP_URL_QUERY), $query);
                foreach (self::PARAMETERS as $name) {
                    if (($value = self::token($query[$name] ?? null)) !== null) {
                        $clicks[$name] = $value;
                    }
                }
            }
            // Explicit keys win over the landing query.
            foreach (self::PARAMETERS as $name) {
                if (($value = self::token($attribution[$name] ?? null)) !== null) {
                    $clicks[$name] = $value;
                }
            }
        }

        if (! isset($ids['fbc']) && isset($clicks['fbclid'])) {
            $fbc = self::token('fb.1.'.$nowMs.'.'.$clicks['fbclid']);
            if ($fbc !== null) {
                $ids['fbc'] = $fbc;
            }
        }
        foreach (['ttclid', 'gclid'] as $name) {
            if (isset($clicks[$name])) {
                $ids[$name] = $clicks[$name];
            }
        }

        return $ids === [] ? null : $ids;
    }

    private static function token(mixed $value): ?string
    {
        if (! is_string($value)) {
            return null;
        }
        $value = trim($value);

        return preg_match(self::TOKEN, $value) === 1 ? $value : null;
    }
}
