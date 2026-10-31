<?php

namespace App\Modules\OnlinePayments\Domain;

/**
 * One way of paying for a web order (ADR-006). Offline drivers (cash on delivery, bank
 * transfer) need no redirect and are confirmed by staff; online drivers (E8c) add
 * verify / parseWebhook / refund, where "paid" is only ever decided server-to-server.
 */
interface PaymentGateway
{
    public function code(): GatewayCode;

    /**
     * Starts paying for a just-placed order.
     *
     * @param  array{id: string, number: string, total: string, currency: string}  $order
     */
    public function initiate(array $order): GatewayInitiation;

    public function supportsRefund(): bool;
}
