<?php

namespace App\Modules\Purchasing\Domain\Reorder;

enum ReorderReason: string
{
    /** Available stock is at or below the configured minimum (rule or reorder level). */
    case BelowMin = 'below_min';
    /** Above the minimum, but sales will use it up before a new delivery arrives. */
    case Velocity = 'velocity';
}
