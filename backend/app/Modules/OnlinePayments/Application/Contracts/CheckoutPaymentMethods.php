<?php

namespace App\Modules\OnlinePayments\Application\Contracts;

use App\Modules\OnlinePayments\Domain\GatewayInitiation;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;

/**
 * What checkout may ask the OnlinePayments module (organization from the tenant context).
 * Methods nobody configured yet appear with their defaults (COD on, bank transfer off).
 *
 * @phpstan-type MethodConfig array{
 *   code: string, display_name: string, is_enabled: bool, instructions: ?string,
 *   settings: array<string, mixed>, sort_order: int
 * }
 */
interface CheckoutPaymentMethods
{
    /**
     * @return list<MethodConfig> every method, by sort order
     */
    public function all(): array;

    /**
     * @return list<MethodConfig> the enabled methods, by sort order
     */
    public function enabled(): array;

    /**
     * The method's configuration when the shopper may pay this order with it: enabled, and
     * for cash on delivery allowed by the delivery method and within `max_order_total`.
     *
     * @return MethodConfig
     *
     * @throws BusinessRuleViolation PAYMENT_METHOD_UNAVAILABLE
     */
    public function usable(string $code, string $orderTotal, bool $deliveryAllowsCod): array;

    /**
     * Hands a just-placed order to the method's driver (offline methods never redirect).
     *
     * @param  array{id: string, number: string, total: string, currency: string}  $order
     */
    public function initiate(string $code, array $order): GatewayInitiation;
}
