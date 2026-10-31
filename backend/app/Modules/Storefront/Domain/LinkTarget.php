<?php

namespace App\Modules\Storefront\Domain;

/**
 * Links an admin may put on the storefront: a site-relative path ("/sale") or an
 * absolute http(s) URL. Everything else (javascript:, data:, protocol-relative
 * "//host", mailto: in nav links) is refused.
 */
final class LinkTarget
{
    public static function isSafe(string $link): bool
    {
        if ($link === '' || strlen($link) > 255 || preg_match('/[\s\x00-\x1F\x7F]/', $link) === 1) {
            return false;
        }

        if (str_starts_with($link, '/')) {
            return ! str_starts_with($link, '//') && ! str_contains($link, '\\');
        }

        $scheme = parse_url($link, PHP_URL_SCHEME);
        $host = parse_url($link, PHP_URL_HOST);

        return in_array(is_string($scheme) ? strtolower($scheme) : null, ['http', 'https'], true) && is_string($host) && $host !== '';
    }
}
