<?php

namespace App\Modules\Orders\Application\Contracts;

/**
 * "Did this customer receive this product?" — asked by the Reviews module (E9): only a
 * customer with a delivered web order line of the product may review it. Scoped to the
 * organization in the tenant context.
 */
interface PurchaseVerifier
{
    /**
     * The id of the customer's most recent delivered order line of the product, or null.
     */
    public function deliveredLine(string $customerId, string $productId): ?string;
}
