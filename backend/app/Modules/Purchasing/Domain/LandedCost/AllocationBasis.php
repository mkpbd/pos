<?php

namespace App\Modules\Purchasing\Domain\LandedCost;

/**
 * SC3: how a charge is spread over receipt lines — by line value (subtotal before tax) or by
 * base quantity.
 */
enum AllocationBasis: string
{
    case Value = 'value';
    case Quantity = 'quantity';
}
