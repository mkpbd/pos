<?php

namespace App\Modules\Organizations\Domain\Enums;

/**
 * Whether catalogue selling prices already include tax.
 */
enum TaxMode: string
{
    case Exclusive = 'exclusive';
    case Inclusive = 'inclusive';
}
