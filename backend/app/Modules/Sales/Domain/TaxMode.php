<?php

namespace App\Modules\Sales\Domain;

/**
 * Whether selling prices already contain tax (inclusive) or tax is added on top (exclusive).
 * Mirrors the organization setting; snapshotted on every sale.
 */
enum TaxMode: string
{
    case Inclusive = 'inclusive';
    case Exclusive = 'exclusive';
}
