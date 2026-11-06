<?php

namespace App\Modules\Purchasing\Domain\Procurement;

enum QuoteStatus: string
{
    case Received = 'received';
    case Declined = 'declined';
}
