<?php

namespace App\Modules\Sales\Domain;

enum DiscountType: string
{
    case Percent = 'percent';
    case Amount = 'amount';
}
