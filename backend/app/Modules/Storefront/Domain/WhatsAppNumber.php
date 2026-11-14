<?php

namespace App\Modules\Storefront\Domain;

use App\Modules\Shared\Domain\BangladeshMobile;

/**
 * P2b: the store's WhatsApp number as wa.me wants it — E.164 digits without "+"
 * (`8801712345678`). Accepts a Bangladeshi mobile in national form (`01712345678`), with the
 * country code (`+8801712345678`, `8801712345678`, `008801712345678`) or any international
 * number written with "+" (8–15 digits, no leading zero after the "+"). Spaces, dashes, dots and
 * parentheses are ignored.
 */
final class WhatsAppNumber
{
    public const MAX = 15;

    /**
     * The normalized number, or null when the input is not a usable WhatsApp number.
     */
    public static function normalize(?string $input): ?string
    {
        if ($input === null) {
            return null;
        }
        $bangladesh = BangladeshMobile::normalize($input);
        if ($bangladesh !== null) {
            return '88'.$bangladesh;
        }
        $compact = preg_replace('/[\s\-().]/', '', trim($input)) ?? '';
        if (str_starts_with($compact, '00')) {
            $compact = '+'.substr($compact, 2);
        }

        return preg_match('/^\+[1-9]\d{7,14}$/', $compact) === 1 ? substr($compact, 1) : null;
    }
}
