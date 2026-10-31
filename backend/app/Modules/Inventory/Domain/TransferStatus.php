<?php

namespace App\Modules\Inventory\Domain;

enum TransferStatus: string
{
    /** Stock has left the source store and is not yet in the destination. */
    case InTransit = 'in_transit';
    case Received = 'received';
    /** Dispatched goods went back into the source store. */
    case Cancelled = 'cancelled';
}
