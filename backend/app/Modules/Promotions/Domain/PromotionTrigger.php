<?php

namespace App\Modules\Promotions\Domain;

/**
 * Automatic promotions apply by themselves while live; coupon promotions only when the
 * shopper enters one of their codes.
 */
enum PromotionTrigger: string
{
    case Automatic = 'automatic';
    case Coupon = 'coupon';
}
