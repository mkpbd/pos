<?php

namespace App\Modules\Marketing\Domain;

/**
 * P2a: a short link's target — a store path (`/p/eid-sale`, `/product/x?color=red`) — and where
 * `/go/<code>` sends the visitor: the path with the link's UTM parameters (over any the path
 * already carries) and `sl=<code>`.
 */
final class ShortLinkTarget
{
    public const MAX = 255;

    /**
     * Whether a target is a store path: starts with a single "/", no scheme, backslash, control
     * characters or spaces, at most 255 characters, not the short link prefix itself.
     */
    public static function isValid(mixed $path): bool
    {
        return is_string($path)
            && $path !== ''
            && mb_strlen($path) <= self::MAX
            && $path[0] === '/'
            && ! str_starts_with($path, '//')
            && ! str_contains($path, '\\')
            && preg_match('/[\p{Cc}\s]/u', $path) !== 1
            && preg_match('//u', $path) === 1
            && preg_match('#^/go(/|$|\?)#', $path) !== 1;
    }

    /**
     * @param  array<string, ?string>  $utm  source, medium, campaign, content, term
     */
    public static function redirect(string $path, array $utm, string $code): string
    {
        $fragment = '';
        if (str_contains($path, '#')) {
            [$path, $fragment] = explode('#', $path, 2);
            $fragment = '#'.$fragment;
        }
        [$base, $query] = array_pad(explode('?', $path, 2), 2, '');
        parse_str($query, $params);
        foreach ($utm as $key => $value) {
            if (is_string($value) && $value !== '') {
                $params['utm_'.$key] = $value;
            }
        }
        $params['sl'] = $code;

        return $base.'?'.http_build_query($params, '', '&', PHP_QUERY_RFC3986).$fragment;
    }
}
