<?php

namespace App\Modules\Products\Application\Contracts;

/**
 * AI2a: moves products to another category for modules that suggest categories (OnlineCatalog's
 * AI category suggestions). The caller checks `products.manage`, the permission that edits a
 * product's category. One transaction for all assignments; each changed product is audited
 * (`product.updated`, old and new category_id) like an edit in the product form.
 */
interface ProductCategoryAssignment
{
    public const SKIP_PRODUCT_NOT_FOUND = 'product_not_found';

    public const SKIP_CATEGORY_NOT_FOUND = 'category_not_found';

    public const SKIP_UNCHANGED = 'unchanged';

    /**
     * Sets each product's category. Products of other organizations or archived ones
     * (`product_not_found`), categories that do not exist or are inactive (`category_not_found`)
     * and products already in that category (`unchanged`) are skipped.
     *
     * @param  list<array{product_id: string, category_id: string}>  $assignments
     * @param  array<string, mixed>  $auditContext  extra audit details (e.g. the source)
     * @return array{applied: list<string>, skipped: list<array{product_id: string, reason: string}>}
     */
    public function assign(string $organizationId, array $assignments, array $auditContext = []): array;
}
