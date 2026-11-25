<?php

namespace App\Modules\Pos\Application\Services;

use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\Cookie;

/**
 * POS1a: the `pos_terminal` cookie that makes a browser a till — a random token (64 characters),
 * httpOnly, SameSite=Lax, secure outside local development, kept for 400 days (the browsers'
 * maximum). It is encrypted like the session cookie on the SPA's requests; only the token's
 * SHA-256 is stored.
 */
final class TerminalCookie
{
    public const NAME = 'pos_terminal';

    public const DAYS = 400;

    public static function newToken(): string
    {
        return Str::random(64);
    }

    public static function hash(string $token): string
    {
        return hash('sha256', $token);
    }

    /** SHA-256 of this device's till token, or null when it has none. */
    public static function tokenHash(Request $request): ?string
    {
        $token = $request->cookie(self::NAME);

        return is_string($token) && strlen($token) >= 40 && strlen($token) <= 200 ? self::hash($token) : null;
    }

    public static function make(string $token): Cookie
    {
        return cookie(
            self::NAME,
            $token,
            self::DAYS * 24 * 60,
            '/',
            config('session.domain'),
            ! app()->environment('local'),
            true,
            false,
            'lax',
        );
    }
}
