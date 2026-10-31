<?php

namespace App\Modules\Storefront\Domain;

/**
 * What a menu item points at. Further types (category, brand, page, blog category)
 * are added in the phases that ship their storefront pages, so a menu can never
 * link to a page that does not exist yet.
 */
enum MenuItemType: string
{
    case Custom = 'custom';
}
