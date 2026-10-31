<?php

namespace App\Modules\Inventory\Domain;

enum MovementType: string
{
    case Opening = 'opening';
    case AdjustmentIn = 'adjustment_in';
    case AdjustmentOut = 'adjustment_out';
    case TransferOut = 'transfer_out';
    case TransferIn = 'transfer_in';
    case PurchaseReceipt = 'purchase_receipt';
    case PurchaseReturn = 'purchase_return';
    case Sale = 'sale';
    case SaleReturn = 'sale_return';

    /**
     * Inbound movements bring their own unit cost and update the weighted average;
     * outbound movements leave at the current average cost.
     */
    public function isInbound(): bool
    {
        return in_array($this, [self::Opening, self::AdjustmentIn, self::TransferIn, self::PurchaseReceipt, self::SaleReturn], true);
    }
}
