<?php

namespace App\Modules\CustomerAccounts\Application\Actions;

use App\Modules\CustomerAccounts\Infrastructure\Models\CustomerAccount;
use App\Modules\Customers\Application\Actions\OnlineCustomerProfiles;
use Illuminate\Support\Facades\DB;

/**
 * Creates a store account together with its NEW customer record (never linked to an
 * existing POS customer, ADR-018). No session, no e-mail: see RegisterCustomer.
 *
 * BD1a: an account created with a mobile number has no password, maybe no e-mail address, and
 * its phone is verified (`phone_verified: true` stamps phone_verified_at; one verified phone per
 * organization, enforced by a unique index).
 */
class CreateCustomerAccount
{
    public function __construct(private readonly OnlineCustomerProfiles $customers) {}

    /**
     * @param  array{name: string, email?: ?string, phone?: ?string, password?: ?string, phone_verified?: bool}  $data  validated; phone normalized
     */
    public function __invoke(array $data): CustomerAccount
    {
        $email = isset($data['email']) && trim((string) $data['email']) !== '' ? mb_strtolower(trim((string) $data['email'])) : null;
        $phone = ($data['phone'] ?? null) ?: null;
        $verified = $phone !== null && ($data['phone_verified'] ?? false) === true;

        return DB::transaction(function () use ($data, $email, $phone, $verified) {
            $customerId = $this->customers->register(trim($data['name']), $email, $phone);

            return CustomerAccount::query()->create([
                'customer_id' => $customerId,
                'email' => $email,
                'phone' => $phone,
                'phone_verified_at' => $verified ? now() : null,
                'password' => ($data['password'] ?? null) ?: null,
            ]);
        });
    }
}
