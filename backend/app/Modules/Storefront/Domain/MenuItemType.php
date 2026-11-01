<?php

namespace App\Modules\Storefront\Domain;

/**
 * What a menu item points at: a typed link, or a record whose address the storefront
 * resolves (a content page: /pages/{slug}, a category: /category/{slug}, a brand:
 * /brand/{slug}). An item whose record is not visible on the storefront is left out.
 * Blog links (E11): `blog` is the blog index (/blog, no record), `blog_category`
 * (/blog/category/{slug}) and `blog_post` (/blog/{slug}, only once readable).
 */
enum MenuItemType: string
{
    case Custom = 'custom';
    case Page = 'page';
    case Category = 'category';
    case Brand = 'brand';
    case Blog = 'blog';
    case BlogCategory = 'blog_category';
    case BlogPost = 'blog_post';

    /** Types that point at a record (`target_id`). */
    public const TARGETED = ['page', 'category', 'brand', 'blog_category', 'blog_post'];

    public function hasTarget(): bool
    {
        return in_array($this->value, self::TARGETED, true);
    }
}
