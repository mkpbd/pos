<?php

namespace App\Modules\Orders\Domain;

/**
 * Why goods of a web order come back (E10b).
 */
enum ReturnReason: string
{
    case Damaged = 'damaged';
    case WrongItem = 'wrong_item';
    case NotAsDescribed = 'not_as_described';
    case ChangedMind = 'changed_mind';
    case Other = 'other';

    public function label(): string
    {
        return match ($this) {
            self::Damaged => 'Damaged or defective',
            self::WrongItem => 'Wrong item received',
            self::NotAsDescribed => 'Not as described',
            self::ChangedMind => 'Changed my mind',
            self::Other => 'Other',
        };
    }
}
