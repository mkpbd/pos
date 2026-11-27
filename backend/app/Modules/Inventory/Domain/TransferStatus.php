<?php

namespace App\Modules\Inventory\Domain;

enum TransferStatus: string
{
    /** A branch asked for stock; nothing has moved yet. The source dispatches or rejects it. */
    case Requested = 'requested';
    /** Stock has left the source store and is not yet in the destination. */
    case InTransit = 'in_transit';
    case Received = 'received';
    /** Dispatched goods went back into the source store. */
    case Cancelled = 'cancelled';
    /** The source branch declined a request. */
    case Rejected = 'rejected';
}
