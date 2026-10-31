<?php

namespace App\Modules\Payments\Domain;

enum PaymentDirection: string
{
    case In = 'in';
    case Out = 'out';
}
