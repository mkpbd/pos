<?php

namespace App\Modules\Products\Domain;

/**
 * Barcode rules. Any printable payload is accepted (Code 128, QR content, internal codes),
 * but purely numeric codes of GTIN length (8, 12, 13, 14 digits: EAN-8, UPC-A, EAN-13,
 * GTIN-14) must carry a correct GS1 check digit, catching typos at data entry.
 */
final class Barcode
{
    public const MAX_LENGTH = 128;

    public static function normalize(string $barcode): string
    {
        return trim($barcode);
    }

    public static function isValid(string $barcode): bool
    {
        if ($barcode === '' || strlen($barcode) > self::MAX_LENGTH || ! preg_match('/^[\x21-\x7E]+$/', $barcode)) {
            return false;
        }

        if (ctype_digit($barcode) && in_array(strlen($barcode), [8, 12, 13, 14], true)) {
            return self::gs1CheckDigit(substr($barcode, 0, -1)) === (int) substr($barcode, -1);
        }

        return true;
    }

    /**
     * GS1 mod-10: weights 3,1,3,… from the rightmost data digit.
     */
    public static function gs1CheckDigit(string $digits): int
    {
        $sum = 0;
        $weight = 3;
        for ($i = strlen($digits) - 1; $i >= 0; $i--) {
            $sum += (int) $digits[$i] * $weight;
            $weight = $weight === 3 ? 1 : 3;
        }

        return (10 - $sum % 10) % 10;
    }
}
