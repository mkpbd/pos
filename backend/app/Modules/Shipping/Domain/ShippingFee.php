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

    /**
     * BD2a: a method's fee for one delivery, before `free_over`: base fee + the delivery area's
     * adjustment (may be negative) + every started kg above `$includedKg` × `$perExtraKg`
     * (no weight pricing when `$includedKg` is null), never below 0.
     *
     * @return array{fee: string, base_fee: string, area_adjustment: string, weight_fee: string}
     */
    public static function forDelivery(string $baseFee, string $areaAdjustment, ?string $includedKg, string $perExtraKg, int $weightGrams): array
    {
        $extraKg = 0;
        if ($includedKg !== null) {
            $extraGrams = $weightGrams - (int) Decimal::mul($includedKg, '1000', 0);
            $extraKg = $extraGrams > 0 ? intdiv($extraGrams + 999, 1000) : 0;
        }
        $weightFee = Decimal::mul($perExtraKg, (string) $extraKg, 2);
        $fee = Decimal::add(Decimal::add($baseFee, $areaAdjustment, 2), $weightFee, 2);

        return [
            'fee' => Decimal::isNegative($fee) ? '0.00' : Decimal::round($fee, 2),
            'base_fee' => Decimal::round($baseFee, 2),
            'area_adjustment' => Decimal::round($areaAdjustment, 2),
            'weight_fee' => Decimal::round($weightFee, 2),
        ];
    }

    public static function cashOnDelivery(bool $codAllowed, string $codFee, bool $payingOnDelivery): string
    {
        return $codAllowed && $payingOnDelivery ? Decimal::round($codFee, 2) : '0.00';
    }
}
