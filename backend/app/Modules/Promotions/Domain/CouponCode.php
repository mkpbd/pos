<?php

namespace App\Modules\Promotions\Domain;

/**
 * Coupon codes are stored upper-case: 3–40 letters, digits and hyphens. Shoppers may type
 * them in any case and with surrounding spaces.
 */
final class CouponCode
{
    public const PATTERN = '/^[A-Z0-9-]{3,40}$/';

    /** Generated codes avoid look-alike characters (0/O, 1/I/L). */
    private const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

    public static function normalize(string $code): string
    {
        return strtoupper(trim($code));
    }

    public static function isValid(string $code): bool
    {
        return preg_match(self::PATTERN, $code) === 1;
    }

    /**
     * A random code: the prefix plus $length characters.
     */
    public static function random(string $prefix = '', int $length = 8): string
    {
        $code = '';
        for ($i = 0; $i < $length; $i++) {
            $code .= self::ALPHABET[random_int(0, strlen(self::ALPHABET) - 1)];
        }

        return self::normalize($prefix).$code;
    }
}
