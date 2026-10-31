<?php

namespace App\Modules\Shared\Domain;

/**
 * Bangladeshi mobile numbers in the national form `01XXXXXXXXX` (11 digits, operator
 * prefix 013–019). Input may carry the country code (+88 / 88) and spaces, dashes,
 * dots or parentheses.
 */
final class BangladeshMobile
{
    public const PATTERN = '/^01[3-9]\d{8}$/';

    /**
     * The normalized number, or null when the input is not a Bangladeshi mobile number.
     */
    public static function normalize(?string $input): ?string
    {
        if ($input === null) {
            return null;
        }

        $digits = preg_replace('/[\s\-().]/', '', trim($input)) ?? '';
        if (str_starts_with($digits, '+88')) {
            $digits = substr($digits, 3);
        } elseif (str_starts_with($digits, '0088')) {
            $digits = substr($digits, 4);
        } elseif (str_starts_with($digits, '88') && strlen($digits) === 13) {
            $digits = substr($digits, 2);
        }

        return preg_match(self::PATTERN, $digits) === 1 ? $digits : null;
    }
}
