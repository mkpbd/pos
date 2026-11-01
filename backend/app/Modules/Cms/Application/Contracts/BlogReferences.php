<?php

namespace App\Modules\Cms\Application\Contracts;

/**
 * Implemented by modules that link to blog categories or posts (menus, homepage sections).
 * Implementations are tagged BlogReferences::TAG; a category or post any of them still uses
 * cannot be deleted (IN_USE).
 */
interface BlogReferences
{
    public const TAG = 'cms.blog_references';

    public const CATEGORY = 'blog_category';

    public const POST = 'blog_post';

    /**
     * Whether the current organization still links to this record. `$type` is
     * BlogReferences::CATEGORY or BlogReferences::POST.
     */
    public function uses(string $type, string $id): bool;

    /**
     * Where it is used, for the error message ("the main menu", "a homepage section").
     */
    public function describe(): string;
}
