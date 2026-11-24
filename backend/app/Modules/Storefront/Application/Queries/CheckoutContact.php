<?php

namespace App\Modules\Storefront\Application\Queries;

use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Sms\Application\Contracts\SmsSender;

/**
 * BD1a: the contact fields of the current store's checkout, as shoppers get them — the
 * customer e-mail field (`required` | `optional` | `hidden`) and the phone check with an SMS
 * code (`off` | `cod` | `all`). The phone check is effective only while the organization
 * can send codes (SmsSender::otpReady): when SMS stops working, checkout goes on without it
 * instead of blocking every order. `phone_login`: shoppers can sign in with a code.
 */
class CheckoutContact
{
    public function __construct(
        private readonly StorefrontConfig $config,
        private readonly SmsSender $sms,
        private readonly TenantContext $tenant,
    ) {}

    public function emailMode(): string
    {
        return $this->config->settings()->checkout_email ?? 'optional';
    }

    public function phoneVerification(): string
    {
        $mode = $this->config->settings()->checkout_phone_verification ?? 'off';

        return $mode !== 'off' && $this->otpReady() ? $mode : 'off';
    }

    /**
     * Whether an order paid with `$paymentMethod` needs a checked mobile number.
     */
    public function phoneCheckNeeded(string $paymentMethod): bool
    {
        return match ($this->phoneVerification()) {
            'all' => true,
            'cod' => $paymentMethod === 'cod',
            default => false,
        };
    }

    public function phoneLogin(): bool
    {
        return $this->otpReady();
    }

    private function otpReady(): bool
    {
        return $this->sms->otpReady($this->tenant->requireOrganization());
    }
}
