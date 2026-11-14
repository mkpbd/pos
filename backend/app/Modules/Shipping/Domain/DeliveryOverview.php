<?php

namespace App\Modules\Shipping\Domain;

use App\Modules\Shared\Domain\ValueObjects\Decimal;

/**
 * P1b: one line of the product page's delivery note for a delivery zone, from its active
 * methods: the method's name when the zone has exactly one, the fastest and slowest delivery
 * in days, the fee and the free-delivery threshold when every method agrees (null otherwise:
 * "depends on the method chosen at checkout") and whether any method allows cash on delivery.
 * Pure: amounts are compared as exact decimals.
 */
final class DeliveryOverview
{
    /**
     * @param  list<array{name: string, fee: string, free_over: ?string, cod_allowed: bool, eta_min_days: int, eta_max_days: int}>  $methods  the zone's active methods, at least one
     * @return array{zone: string, method: ?string, min_days: int, max_days: int, fee: ?string, free_over: ?string, cod_allowed: bool}
     */
    public static function zone(string $zone, array $methods): array
    {
        $fees = array_values(array_unique(array_map(fn (array $m) => Decimal::round($m['fee'], 2), $methods)));
        $thresholds = array_values(array_unique(array_map(fn (array $m) => $m['free_over'] === null ? null : Decimal::round($m['free_over'], 2), $methods), SORT_REGULAR));

        return [
            'zone' => $zone,
            'method' => count($methods) === 1 ? $methods[0]['name'] : null,
            'min_days' => min(array_column($methods, 'eta_min_days')),
            'max_days' => max(array_column($methods, 'eta_max_days')),
            'fee' => count($fees) === 1 ? $fees[0] : null,
            'free_over' => count($thresholds) === 1 ? $thresholds[0] : null,
            'cod_allowed' => in_array(true, array_column($methods, 'cod_allowed'), true),
        ];
    }
}
