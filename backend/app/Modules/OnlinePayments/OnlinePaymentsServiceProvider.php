<?php

namespace App\Modules\OnlinePayments;

use App\Modules\OnlinePayments\Application\Contracts\CheckoutPaymentMethods;
use App\Modules\OnlinePayments\Infrastructure\EloquentCheckoutPaymentMethods;
use App\Modules\Shared\Infrastructure\Providers\ModuleServiceProvider;

/**
 * How shoppers pay for web orders (ADR-006). E8a: the offline methods cash on delivery and
 * bank transfer behind the PaymentGateway interface, configured per organization. Online
 * gateways (SSLCommerz, bKash, Nagad) with server-side verification arrive in E8c.
 */
class OnlinePaymentsServiceProvider extends ModuleServiceProvider
{
    public function register(): void
    {
        $this->app->bind(CheckoutPaymentMethods::class, EloquentCheckoutPaymentMethods::class);
    }

    protected function permissions(): array
    {
        return [
            'payment_gateways.manage' => 'Configure the online store\'s payment methods (cash on delivery, bank transfer, gateways)',
        ];
    }
}
