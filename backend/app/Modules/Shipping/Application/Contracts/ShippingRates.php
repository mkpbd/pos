<?php

namespace App\Modules\Shipping\Application\Contracts;

/**
 * What checkout may ask the Shipping module (organization from the tenant context):
 * the active delivery methods of the active zone that covers a district.
 *
 * @phpstan-type ShippingOption array{
 *   id: string, name: string, description: ?string, fee: string, free_over: ?string,
 *   cod_allowed: bool, cod_fee: string, eta_min_days: int, eta_max_days: int
 * }
 */
interface ShippingRates
{
    /**
     * @return list<ShippingOption> in display order; [] when no active zone/method covers it
     */
    public function methodsForDistrict(int $districtId): array;

    /**
     * The method when it is offered for the district, else null.
     *
     * @return ShippingOption|null
     */
    public function methodForDistrict(string $methodId, int $districtId): ?array;

    /**
     * P2a: every active delivery method of the active zones (request's language) and, per
     * district a zone covers, the ids of its methods in display order — the order form's
     * district → delivery method hints (the checkout preview stays authoritative).
     *
     * @return array{methods: list<ShippingOption>, districts: array<string, list<string>>}
     */
    public function districtMethods(): array;

    /**
     * P1b: the product page's delivery note — one entry per active zone that covers at least one
     * district and has an active method, in zone order (Domain\DeliveryOverview: method name when
     * the zone has one, fastest / slowest days, the fee and free-over threshold when its methods
     * agree, else null, and whether any method allows cash on delivery). Method names in the
     * request's language. [] when shipping is not set up.
     *
     * @return list<array{zone: string, method: ?string, min_days: int, max_days: int, fee: ?string, free_over: ?string, cod_allowed: bool}>
     */
    public function zoneOverview(): array;
}
