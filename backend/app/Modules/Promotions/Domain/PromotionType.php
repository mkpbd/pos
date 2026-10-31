<?php

namespace App\Modules\Promotions\Domain;

/**
 * What a promotion gives: a percentage off, a fixed amount off (per unit for product
 * scopes, once per order for the order scope) or free delivery (order scope only).
 */
enum PromotionType: string
{
    case Percent = 'percent';
    case Fixed = 'fixed';
    case FreeShipping = 'free_shipping';
}
