<?php

namespace App\Modules\Shipping\Domain;

use App\Modules\Shared\Domain\ValueObjects\Decimal;

/**
 * Delivery charges of a method for an order. Flat fee, free when the goods total (after tax,
 * before delivery) reaches `free_over`. The cash-on-delivery fee applies only when the
 * shopper pays on delivery. Neither is taxed in E8a.
 */
final class ShippingFee
{
    public static function delivery(string $fee, ?string $freeOver, string $goodsTotal): string
    {
        if ($freeOver !== null && Decimal::compare($goodsTotal, $freeOver) >= 0) {
            return '0.00';
        }

        return Decimal::round($fee, 2);
    }

    public static function cashOnDelivery(bool $codAllowed, string $codFee, bool $payingOnDelivery): string
    {
        return $codAllowed && $payingOnDelivery ? Decimal::round($codFee, 2) : '0.00';
    }
}
