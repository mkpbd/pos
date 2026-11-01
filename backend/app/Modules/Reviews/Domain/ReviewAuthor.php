<?php

namespace App\Modules\Reviews\Domain;

/**
 * How a reviewer is named in public: first name and the initial of the last name
 * ("Rina Akter" → "Rina A."), nothing more of their personal data.
 */
final class ReviewAuthor
{
    public static function publicName(?string $fullName): string
    {
        $parts = preg_split('/\s+/u', trim((string) $fullName), -1, PREG_SPLIT_NO_EMPTY) ?: [];
        if ($parts === []) {
            return 'Customer';
        }
        $first = $parts[0];
        if (count($parts) === 1) {
            return $first;
        }

        return $first.' '.mb_strtoupper(mb_substr($parts[count($parts) - 1], 0, 1)).'.';
    }
}
