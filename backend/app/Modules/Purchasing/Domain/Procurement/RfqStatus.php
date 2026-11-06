<?php

namespace App\Modules\Purchasing\Domain\Procurement;

/**
 * draft → sent (requests issued to the invited suppliers; quotes are recorded) → awarded
 * (draft purchase orders created) or closed (ended without award); draft/sent → cancelled.
 */
enum RfqStatus: string
{
    case Draft = 'draft';
    case Sent = 'sent';
    case Closed = 'closed';
    case Awarded = 'awarded';
    case Cancelled = 'cancelled';
}
