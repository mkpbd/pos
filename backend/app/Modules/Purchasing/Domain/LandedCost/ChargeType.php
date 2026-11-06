<?php

namespace App\Modules\Purchasing\Domain\LandedCost;

/**
 * SC3: kinds of landed cost charged on top of the goods.
 */
enum ChargeType: string
{
    case Freight = 'freight';
    case Duty = 'duty';
    case Insurance = 'insurance';
    case Handling = 'handling';
    case Other = 'other';

    public function label(): string
    {
        return match ($this) {
            self::Freight => 'Freight',
            self::Duty => 'Duty',
            self::Insurance => 'Insurance',
            self::Handling => 'Handling',
            self::Other => 'Other',
        };
    }
}
