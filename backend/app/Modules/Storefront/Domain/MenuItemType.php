<?php

namespace App\Modules\Storefront\Domain;

/**
 * What a menu item points at: a typed link, or a record whose address the storefront
 * resolves (a content page: /pages/{slug}). Category, brand and blog-category targets
 * are added in the phases that ship their storefront pages, so a menu can never link
 * to a page that does not exist yet.
 */
enum MenuItemType: string
{
    case Custom = 'custom';
    case Page = 'page';
}
