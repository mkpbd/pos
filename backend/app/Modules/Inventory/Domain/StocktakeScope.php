<?php

namespace App\Modules\Inventory\Domain;

/**
 * ST1: what a stocktake counts — the whole store, some categories (with their sub-categories)
 * or some products.
 */
enum StocktakeScope: string
{
    case All = 'all';
    case Categories = 'categories';
    case Products = 'products';
}
