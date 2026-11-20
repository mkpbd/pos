<?php

namespace App\Modules\Storefront\Domain;

/**
 * B16: addresses of storefront redirects (pure).
 *
 * - from(): the normalized "old address" — the path only (a full URL loses its host, query and
 *   fragment), percent-decoded, lower case, single slashes, no trailing slash; null when it is
 *   not a usable path (empty, too long, spaces or control characters, backslashes).
 * - target(): where a redirect goes — a store path (normalized like from() but keeping its query)
 *   or, when `$allowExternal`, an absolute http(s) URL. A URL on one of the store's own hosts
 *   becomes its path.
 * - reserved(): addresses that always answer themselves (the home page, the shop, the account,
 *   cart and checkout, the API, the admin, files), so a redirect from them would never apply.
 */
final class RedirectPaths
{
    public const MAX_FROM = 500;

    public const MAX_TO = 1000;

    /** Exact store paths that are always pages. */
    private const RESERVED = [
        '/', '/shop', '/search', '/blog', '/cart', '/wishlist', '/checkout',
        '/newsletter/confirm', '/newsletter/unsubscribe', '/robots.txt', '/sitemap.xml', '/demos',
    ];

    /** Path prefixes owned by the API, the admin, files, tooling and the shopper's own pages. */
    private const RESERVED_PREFIXES = ['/api', '/sanctum', '/storage', '/admin', '/docs', '/up', '/account', '/order', '/sitemaps'];

    public static function from(string $value): ?string
    {
        $value = trim($value);
        if (preg_match('#^https?://#i', $value) === 1) {
            $path = parse_url($value, PHP_URL_PATH);
            $value = is_string($path) ? $path : '/';
        }
        $value = preg_replace('/[?#].*$/s', '', $value) ?? '';

        return self::path($value, self::MAX_FROM);
    }

    /**
     * @param  list<string>  $ownHosts  the store's own host names (lower case)
     */
    public static function target(string $value, array $ownHosts, bool $allowExternal): ?string
    {
        $value = trim($value);
        if (preg_match('#^https?://#i', $value) === 1) {
            $host = parse_url($value, PHP_URL_HOST);
            if (! is_string($host) || $host === '') {
                return null;
            }
            if (! in_array(strtolower($host), $ownHosts, true)) {
                return $allowExternal && strlen($value) <= self::MAX_TO && preg_match('/[\s\x00-\x1F\x7F\\\\]/', $value) !== 1 ? $value : null;
            }
            $path = parse_url($value, PHP_URL_PATH);
            $query = parse_url($value, PHP_URL_QUERY);
            $value = (is_string($path) ? $path : '/').(is_string($query) && $query !== '' ? '?'.$query : '');
        }
        if (! str_starts_with($value, '/')) {
            return null;
        }
        $value = preg_replace('/#.*$/s', '', $value) ?? '';
        [$path, $query] = array_pad(explode('?', $value, 2), 2, null);
        $path = self::path($path, self::MAX_TO);
        if ($path === null || ($query !== null && preg_match('/[\s\x00-\x1F\x7F]/', $query) === 1)) {
            return null;
        }
        $target = $path.($query !== null && $query !== '' ? '?'.$query : '');

        return strlen($target) <= self::MAX_TO ? $target : null;
    }

    /**
     * The path part of a stored target (null for an outside URL).
     */
    public static function targetPath(string $target): ?string
    {
        return str_starts_with($target, '/') ? explode('?', $target, 2)[0] : null;
    }

    public static function reserved(string $path): bool
    {
        if (in_array($path, self::RESERVED, true)) {
            return true;
        }
        foreach (self::RESERVED_PREFIXES as $prefix) {
            if ($path === $prefix || str_starts_with($path, $prefix.'/')) {
                return true;
            }
        }

        return false;
    }

    private static function path(string $value, int $max): ?string
    {
        $value = rawurldecode($value);
        if ($value === '' || ! mb_check_encoding($value, 'UTF-8') || preg_match('/[\s\x00-\x1F\x7F\\\\]/u', $value) === 1) {
            return null;
        }
        $value = '/'.ltrim($value, '/');
        $value = preg_replace('#/{2,}#', '/', $value) ?? $value;
        if ($value !== '/') {
            $value = rtrim($value, '/');
        }
        $value = mb_strtolower($value);

        return mb_strlen($value) <= $max ? $value : null;
    }
}
