<?php

namespace App\Modules\Inventory\Domain;

enum AdjustmentReason: string
{
    case Opening = 'opening';
    case Count = 'count';
    case Damage = 'damage';
    case Expiry = 'expiry';
    case Theft = 'theft';
    case Correction = 'correction';
    case Other = 'other';

    /** Reasons that can only reduce stock. */
    public function isLossOnly(): bool
    {
        return in_array($this, [self::Damage, self::Expiry, self::Theft], true);
    }
}
