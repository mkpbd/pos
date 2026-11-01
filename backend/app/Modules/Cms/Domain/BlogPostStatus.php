<?php

namespace App\Modules\Cms\Domain;

use Carbon\CarbonInterface;

/**
 * A blog post is a draft or published; a published post whose publication time lies in
 * the future is `scheduled` (its derived state), and appears on the blog at that time.
 */
enum BlogPostStatus: string
{
    case Draft = 'draft';
    case Published = 'published';

    public const STATES = ['draft', 'scheduled', 'published'];

    /**
     * `draft`, `scheduled` or `published`.
     */
    public function state(?CarbonInterface $publishedAt): string
    {
        return match (true) {
            $this === self::Draft => 'draft',
            $publishedAt !== null && $publishedAt->isFuture() => 'scheduled',
            default => 'published',
        };
    }
}
