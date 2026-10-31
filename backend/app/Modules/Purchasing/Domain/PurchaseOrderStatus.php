<?php

namespace App\Modules\Purchasing\Domain;

enum PurchaseOrderStatus: string
{
    case Draft = 'draft';
    case Ordered = 'ordered';
    case PartiallyReceived = 'partially_received';
    case Received = 'received';
    case Cancelled = 'cancelled';

    public function acceptsReceipts(): bool
    {
        return $this === self::Ordered || $this === self::PartiallyReceived;
    }
}
