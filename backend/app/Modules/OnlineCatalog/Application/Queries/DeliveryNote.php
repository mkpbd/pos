<?php

namespace App\Modules\OnlineCatalog\Application\Queries;

use App\Modules\OnlinePayments\Application\Contracts\CheckoutPaymentMethods;
use App\Modules\Shared\Application\Contracts\StorefrontContentVersion;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shipping\Application\Contracts\ShippingRates;

/**
 * P1b: the delivery and cash-on-delivery note near a product's price — the same for every
 * product of the store, so it is cached per storefront content version and language (zone,
 * method and payment method writes bump the version).
 *
 * `{options: [{zone, method, min_days, max_days, fee, free_over}], cod_available}`, null while
 * shipping is not set up. One option per active zone covering a district with an active method
 * (at most MAX_OPTIONS, zone order); `method` is the method's name when the zone has one,
 * `fee` / `free_over` are null when the zone's methods differ ("depends"). Cash on delivery is
 * available when the COD payment method is on and a listed zone has a method allowing it.
 */
class DeliveryNote
{
    public const MAX_OPTIONS = 10;

    private const COD = 'cod';

    public function __construct(
        private readonly ShippingRates $shipping,
        private readonly CheckoutPaymentMethods $payments,
        private readonly StorefrontContentVersion $version,
        private readonly TenantContext $tenant,
    ) {}

    /**
     * @return array{options: list<array{zone: string, method: ?string, min_days: int, max_days: int, fee: ?string, free_over: ?string}>, cod_available: bool}|null
     */
    public function current(): ?array
    {
        return $this->version->remember($this->tenant->requireOrganization(), 'delivery-note', fn () => $this->build());
    }

    /**
     * @return array{options: list<array{zone: string, method: ?string, min_days: int, max_days: int, fee: ?string, free_over: ?string}>, cod_available: bool}|null
     */
    private function build(): ?array
    {
        $zones = array_slice($this->shipping->zoneOverview(), 0, self::MAX_OPTIONS);
        if ($zones === []) {
            return null;
        }
        $codOn = in_array(self::COD, array_column($this->payments->enabled(), 'code'), true);

        return [
            'options' => array_map(fn (array $z) => [
                'zone' => $z['zone'],
                'method' => $z['method'],
                'min_days' => $z['min_days'],
                'max_days' => $z['max_days'],
                'fee' => $z['fee'],
                'free_over' => $z['free_over'],
            ], $zones),
            'cod_available' => $codOn && in_array(true, array_column($zones, 'cod_allowed'), true),
        ];
    }
}
