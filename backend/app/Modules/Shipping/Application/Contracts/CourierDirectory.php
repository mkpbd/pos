<?php

namespace App\Modules\Shipping\Application\Contracts;

/**
 * Read access to the current organization's couriers for other modules (Orders: shipments,
 * COD remittances, tracking links).
 *
 * @phpstan-type CourierSummary array{id: string, name: string, phone: ?string, tracking_url_template: ?string, is_active: bool}
 */
interface CourierDirectory
{
    /**
     * @return CourierSummary|null null when it is not a courier of the current organization
     */
    public function find(string $courierId): ?array;

    /**
     * @param  list<string>  $courierIds
     * @return array<string, CourierSummary> keyed by id; unknown ids are absent
     */
    public function summaries(array $courierIds): array;

    /**
     * The parcel tracking link of a courier's template for a tracking number, or null.
     */
    public function trackingUrl(?string $template, ?string $trackingNumber): ?string;
}
