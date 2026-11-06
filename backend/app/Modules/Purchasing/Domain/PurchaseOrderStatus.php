<?php

namespace App\Modules\Purchasing\Domain;

enum PurchaseOrderStatus: string
{
    case Draft = 'draft';
    // SC2: submitted for approval (approval limits); approved → ordered, rejected → draft.
    case PendingApproval = 'pending_approval';
    case Ordered = 'ordered';
    case PartiallyReceived = 'partially_received';
    case Received = 'received';
    case Cancelled = 'cancelled';

    public function acceptsReceipts(): bool
    {
        return $this === self::Ordered || $this === self::PartiallyReceived;
    }
}
