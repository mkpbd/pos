<?php

namespace App\Modules\Products\Application\Services;

use App\Modules\Products\Application\Contracts\LabelSources;
use App\Modules\Shared\Application\Contracts\TenantUser;

/**
 * Used when no purchasing module is installed: there are no receipts or orders to label.
 */
class NoLabelSources implements LabelSources
{
    public function goodsReceiptLines(TenantUser $user, string $organizationId, string $goodsReceiptId): ?array
    {
        return null;
    }

    public function purchaseOrderLines(TenantUser $user, string $organizationId, string $purchaseOrderId): ?array
    {
        return null;
    }
}
