<?php

namespace App\Modules\Promotions\Domain;

/**
 * POS1a: where a promotion applies — the online store, the till (POS sales) or both.
 */
enum PromotionChannel: string
{
    case Online = 'online';
    case Till = 'till';

    /**
     * @return list<string>
     */
    public static function values(): array
    {
        return array_map(fn (self $c) => $c->value, self::cases());
    }
}
