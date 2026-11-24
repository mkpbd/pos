<?php

namespace App\Modules\Products\Application\Contracts;

use App\Modules\Shared\Application\Contracts\TenantUser;

/**
 * ST1: the lines of purchasing documents for printing shelf / price labels, declared by Products
 * and implemented by Purchasing (bound with bindIf: without Purchasing there are no documents).
 * Null when the document does not exist or is in a branch the user may not access.
 */
interface LabelSources
{
    /**
     * Received lines of a goods receipt (one per batch).
     *
     * @return list<array{variant_id: string, quantity: string, batch_number: ?string, expires_on: ?string}>|null
     */
    public function goodsReceiptLines(TenantUser $user, string $organizationId, string $goodsReceiptId): ?array;

    /**
     * Ordered lines of a purchase order.
     *
     * @return list<array{variant_id: string, quantity: string, batch_number: null, expires_on: null}>|null
     */
    public function purchaseOrderLines(TenantUser $user, string $organizationId, string $purchaseOrderId): ?array;
}
