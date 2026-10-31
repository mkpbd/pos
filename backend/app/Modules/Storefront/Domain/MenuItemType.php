<?php

namespace App\Modules\Storefront\Domain;

/**
 * What a menu item points at: a typed link, or a record whose address the storefront
 * resolves (a content page: /pages/{slug}, a category: /category/{slug}, a brand:
 * /brand/{slug}). An item whose record is not visible on the storefront is left out.
 * Blog-category targets are added with the blog (E11), so a menu can never link to a
 * page that does not exist yet.
 */
enum MenuItemType: string
{
    case Custom = 'custom';
    case Page = 'page';
    case Category = 'category';
    case Brand = 'brand';
}
