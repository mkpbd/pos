<?php

namespace App\Modules\Orders\Application\Contracts;

/**
 * P2a: the landing page order forms checkout may place orders for (declared here, implemented
 * by the Storefront module, organization from the tenant context): a builder `order_form`
 * element that is live on the store now — its document published and on the store, the
 * element and every node above it shown and inside their schedules.
 */
interface OrderForms
{
    /**
     * The live order form's settings, or null when there is no such live form.
     *
     * @return array{
     *   document_id: string, element_id: string, path: ?string, product_id: string, upsell_product_id: ?string,
     *   quantity_max: int, email: 'hidden'|'optional'|'required', note: 'hidden'|'optional', payment: 'cod_only'|'store_methods'
     * }|null
     */
    public function find(string $documentId, string $elementId): ?array;
}
