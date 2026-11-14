<?php

namespace App\Modules\Social\Domain;

/**
 * P2b: Facebook and Instagram download a post's photos themselves, so (live mode) every photo
 * must be at a public https:// address — not localhost, a private or reserved IP address, a
 * single-label intranet name or a reserved test domain (.test, .local, .localhost, …).
 */
final class PublicUrl
{
    private const PRIVATE_SUFFIXES = ['.localhost', '.local', '.test', '.internal', '.invalid', '.example', '.lan', '.home.arpa'];

    public static function isPublicHttps(?string $url): bool
    {
        if ($url === null || $url === '') {
            return false;
        }
        $parts = parse_url($url);
        if (! is_array($parts) || mb_strtolower((string) ($parts['scheme'] ?? '')) !== 'https' || ! is_string($parts['host'] ?? null)) {
            return false;
        }
        $host = mb_strtolower(trim($parts['host'], '[]'));
        if ($host === '' || $host === 'localhost') {
            return false;
        }
        if (filter_var($host, FILTER_VALIDATE_IP) !== false) {
            return filter_var($host, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE) !== false;
        }
        if (! str_contains($host, '.')) {
            return false;
        }
        foreach (self::PRIVATE_SUFFIXES as $suffix) {
            if (str_ends_with($host, $suffix) || $host === ltrim($suffix, '.')) {
                return false;
            }
        }

        return true;
    }
}
