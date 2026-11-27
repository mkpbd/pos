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
 * @phpstan-type PricedShippingOption array{
 *   id: string, name: string, description: ?string, fee: string, free_over: ?string,
 *   cod_allowed: bool, cod_fee: string, eta_min_days: int, eta_max_days: int,
 *   base_fee: string, area_adjustment: string, weight_fee: string
 * }
 */
interface ShippingRates
{
    /**
     * BD2a: `fee` is the method's fee for this delivery (Domain\ShippingFee::forDelivery):
     * base fee + the area's `fee_adjustment` (when `$areaId` is an active area of the district;
     * an unknown area or one of another district is ignored — callers validate it) + whole extra
     * kg above the method's `weight_included_kg` (rounded up) × `fee_per_extra_kg`, never below 0.
     * `base_fee` / `area_adjustment` / `weight_fee` explain it. `free_over` is still applied by
     * the caller (ShippingFee::delivery with the goods total).
     *
     * @return list<PricedShippingOption> in display order; [] when no active zone/method covers it
     */
    public function methodsForDistrict(int $districtId, ?string $areaId = null, int $weightGrams = 0): array;

    /**
     * The method when it is offered for the district (priced as methodsForDistrict), else null.
     *
     * @return PricedShippingOption|null
     */
    public function methodForDistrict(string $methodId, int $districtId, ?string $areaId = null, int $weightGrams = 0): ?array;

    /**
     * BD2a: the active delivery areas of a district (merchant-defined, e.g. thanas), in
     * display order. [] when the district has none (the address keeps its free-text area).
     *
     * @return list<array{id: string, name: string, fee_adjustment: string}>
     */
    public function areas(int $districtId): array;

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

    /**
     * B17: the active delivery zones in zone order (the store builder's delivery promise):
     * id, name, whether the zone covers at least one district, and its active methods in
     * display order (names in the request's language). [] when shipping is not set up.
     *
     * @return list<array{id: string, name: string, covers_districts: bool, methods: list<ShippingOption>}>
     */
    public function activeZones(): array;
}
