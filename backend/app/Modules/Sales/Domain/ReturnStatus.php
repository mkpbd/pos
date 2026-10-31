<?php

namespace App\Modules\Sales\Domain;

enum ReturnStatus: string
{
    /** Requested; waiting for someone with `returns.approve`. Reserves the returned quantities. */
    case Pending = 'pending';
    /** Approved and posted: stock back, amount credited and refunded. */
    case Completed = 'completed';
    case Rejected = 'rejected';
}
