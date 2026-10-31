<?php

namespace App\Modules\CustomerAccounts\Application\Actions;

use App\Modules\CustomerAccounts\Infrastructure\Models\CustomerAccount;
use App\Modules\Customers\Application\Actions\OnlineCustomerProfiles;
use Illuminate\Support\Facades\DB;

/**
 * Creates a store account together with its NEW customer record (never linked to an
 * existing POS customer, ADR-018). No session, no e-mail: see RegisterCustomer.
 */
class CreateCustomerAccount
{
    public function __construct(private readonly OnlineCustomerProfiles $customers) {}

    /**
     * @param  array{name: string, email: string, phone?: ?string, password: string}  $data  validated; phone normalized
     */
    public function __invoke(array $data): CustomerAccount
    {
        $email = mb_strtolower(trim($data['email']));
        $phone = ($data['phone'] ?? null) ?: null;

        return DB::transaction(function () use ($data, $email, $phone) {
            $customerId = $this->customers->register(trim($data['name']), $email, $phone);

            return CustomerAccount::query()->create([
                'customer_id' => $customerId,
                'email' => $email,
                'phone' => $phone,
                'password' => $data['password'],
            ]);
        });
    }
}
