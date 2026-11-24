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

    /**
     * What a shopper sees of a method in payment method lists: `{code, display_name}`, plus for
     * the Send Money methods (BD1c) `{instructions, account_number, account_type}` — the
     * shop's receiving number is public by design.
     *
     * @param  MethodConfig  $method
     * @return array<string, mixed>
     */
    public function shopperView(array $method): array;

    /**
     * BD1c: the enabled Send Money methods as `{code, display_name, account_number, account_type, instructions}`, by sort order.
     *
     * @return list<array{code: string, display_name: string, account_number: ?string, account_type: string, instructions: ?string}>
     */
    public function sendMoneyMethods(): array;

    /**
     * BD1c: one Send Money method (enabled or not) in the same shape; null for other codes.
     *
     * @return array{code: string, display_name: string, account_number: ?string, account_type: string, instructions: ?string}|null
     */
    public function sendMoneyMethod(string $code): ?array;
}
