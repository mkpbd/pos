<?php

namespace App\Modules\Marketing\Application\Contracts;

use DateTimeInterface;

/**
 * BD1c: what the Conversions API reports about a placed web order (declared here, implemented
 * by the Orders module; organization from the tenant context). Null when the order is not
 * found. `source` storefront | landing_page | staff; `page_path` the landing page an order form
 * was on (null for the cart checkout); `district` the delivery district's name; `tracking_ids`
 * the ad click ids stored at placement ({fbp?, fbc?, ttp?, ttclid?, gclid?} or null); money as
 * NUMERIC strings.
 */
interface ConversionOrders
{
    /**
     * @return array{number: string, source: string, page_path: ?string, placed_at: DateTimeInterface, currency: string,
     *   total: string, contact_name: ?string, contact_email: ?string, contact_phone: ?string, customer_id: ?string,
     *   district: ?string, ip: ?string, user_agent: ?string, tracking_ids: ?array<string, string>,
     *   lines: list<array{sku: ?string, variant_id: ?string, quantity: string}>}|null
     */
    public function purchase(string $orderId): ?array;
}
