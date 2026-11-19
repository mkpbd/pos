<?php

namespace App\Modules\Orders\Application\Contracts;

/**
 * B15: the store builder page an order is attributed to (declared here, implemented by the
 * Storefront module; organization from the tenant context).
 */
interface OrderPageAttribution
{
    /**
     * Whether the id is a builder page, header, footer or shop area of this organization's
     * store (published or not).
     */
    public function isStorePage(string $documentId): bool;

    /**
     * The top-level section of the document's published version that holds this element, or
     * null.
     */
    public function sectionOf(string $documentId, string $elementId): ?string;
}
