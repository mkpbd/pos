<?php

namespace App\Modules\Sales\Domain;

enum SaleStatus: string
{
    case Completed = 'completed';
    case Cancelled = 'cancelled';
}
