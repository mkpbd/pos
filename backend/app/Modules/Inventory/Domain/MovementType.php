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
    case SaleCancellation = 'sale_cancellation';
    case SaleReturn = 'sale_return';
    case OnlineOrder = 'online_order';
    case OnlineOrderCancel = 'online_order_cancel';

    /**
     * Inbound movements bring their own unit cost and update the weighted average;
     * outbound movements leave at the current average cost.
     */
    public function isInbound(): bool
    {
        return in_array($this, [self::Opening, self::AdjustmentIn, self::TransferIn, self::PurchaseReceipt, self::SaleCancellation, self::SaleReturn, self::OnlineOrderCancel], true);
    }

    /**
     * Web orders never oversell (ADR-004): the branch's allow_negative_stock does not apply.
     */
    public function forbidsNegativeStock(): bool
    {
        return $this === self::OnlineOrder;
    }
}
