<?php

namespace App\Modules\Social\Domain;

/**
 * P2b: where a post goes — the connected Facebook Page or its Instagram business account.
 */
enum PostTarget: string
{
    case Facebook = 'facebook';
    case Instagram = 'instagram';

    public function label(): string
    {
        return match ($this) {
            self::Facebook => 'Facebook',
            self::Instagram => 'Instagram',
        };
    }

    /**
     * @return list<string>
     */
    public static function values(): array
    {
        return array_map(fn (self $t) => $t->value, self::cases());
    }
}
