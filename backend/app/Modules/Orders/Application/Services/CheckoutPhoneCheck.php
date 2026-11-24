<?php

namespace App\Modules\Orders\Application\Services;

use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Storefront\Application\Queries\CheckoutContact;
use Closure;

/**
 * BD1a: the store may want the contact mobile number checked with an SMS code before an order
 * is placed — for every order (`all`) or cash-on-delivery orders (`cod`). The number counts as
 * checked when it is the signed-in shopper's verified account number or one the shopper proved
 * with a checkout code in this session. Runs before any stock or locking work.
 */
class CheckoutPhoneCheck
{
    public function __construct(private readonly CheckoutContact $contact) {}

    /**
     * @param  Closure(): list<string>  $verifiedPhones  the account's verified number and the session's checked ones (asked only when the check applies)
     *
     * @throws BusinessRuleViolation PHONE_NOT_VERIFIED
     */
    public function ensure(string $phone, string $paymentMethod, Closure $verifiedPhones): void
    {
        if (! $this->contact->phoneCheckNeeded($paymentMethod) || in_array($phone, $verifiedPhones(), true)) {
            return;
        }

        throw new BusinessRuleViolation('PHONE_NOT_VERIFIED', 'Confirm your mobile number with the code we send you by SMS.', ['phone' => $phone]);
    }
}
