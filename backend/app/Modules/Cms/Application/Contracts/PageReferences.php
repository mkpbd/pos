<?php

namespace App\Modules\Cms\Application\Contracts;

/**
 * Implemented by modules that link to content pages (menus). Implementations are tagged
 * PageReferences::TAG; a page any of them still uses cannot be deleted.
 */
interface PageReferences
{
    public const TAG = 'cms.page_references';

    /**
     * Whether the current organization still links to this page.
     */
    public function uses(string $pageId): bool;
}
