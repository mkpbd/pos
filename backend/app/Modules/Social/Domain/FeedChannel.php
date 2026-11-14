<?php

namespace App\Modules\Social\Domain;

/**
 * P2b: catalog feeds — Meta (Facebook & Instagram Shop / Commerce Manager), TikTok and
 * Pinterest catalogs; all three read the Google Merchant format.
 */
enum FeedChannel: string
{
    case Meta = 'meta';
    case TikTok = 'tiktok';
    case Pinterest = 'pinterest';

    public const FORMATS = ['xml', 'csv'];

    /**
     * @return list<string>
     */
    public static function values(): array
    {
        return array_map(fn (self $c) => $c->value, self::cases());
    }

    public function label(): string
    {
        return match ($this) {
            self::Meta => 'Meta (Facebook & Instagram)',
            self::TikTok => 'TikTok',
            self::Pinterest => 'Pinterest',
        };
    }
}
