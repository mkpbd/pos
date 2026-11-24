<?php

namespace App\Modules\Inventory\Domain;

/**
 * ST1: draft → counting → posted, or cancelled from draft / counting.
 */
enum StocktakeStatus: string
{
    case Draft = 'draft';
    case Counting = 'counting';
    case Posted = 'posted';
    case Cancelled = 'cancelled';

    public function isOpen(): bool
    {
        return $this === self::Draft || $this === self::Counting;
    }
}
