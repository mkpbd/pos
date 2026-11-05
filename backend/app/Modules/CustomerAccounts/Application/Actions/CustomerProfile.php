<?php

namespace App\Modules\CustomerAccounts\Application\Actions;

use App\Modules\CustomerAccounts\Infrastructure\Models\CustomerAccount;
use App\Modules\Customers\Application\Actions\OnlineCustomerProfiles;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\ValidationException;

/**
 * The signed-in shopper's own profile (name and phone live on the customer record, the
 * phone also on the account) and password. Changing the e-mail address is not offered yet.
 */
class CustomerProfile
{
    public function __construct(
        private readonly OnlineCustomerProfiles $customers,
        private readonly Request $request,
    ) {}

    /**
     * @return array{id: string, name: string, email: string, phone: ?string, email_verified: bool}
     */
    public function show(CustomerAccount $account): array
    {
        return [
            'id' => $account->id,
            'name' => $this->customers->find($account->customer_id)['name'] ?? '',
            'email' => $account->email,
            'phone' => $account->phone,
            'email_verified' => $account->email_verified_at !== null,
            // E12b: en | bn (null before the first sign-in since E12b).
            'preferred_locale' => $account->preferred_locale,
        ];
    }

    /**
     * @return array{id: string, name: string, email: string, phone: ?string, email_verified: bool}
     */
    public function update(CustomerAccount $account, string $name, ?string $phone): array
    {
        DB::transaction(function () use ($account, $name, $phone) {
            $account->forceFill(['phone' => $phone ?: null])->save();
            $this->customers->update($account->customer_id, trim($name), $phone ?: null);
        });

        return $this->show($account);
    }

    /**
     * @throws ValidationException when the current password is wrong
     */
    public function changePassword(CustomerAccount $account, string $current, string $new): void
    {
        if (! Hash::check($current, $account->password)) {
            throw ValidationException::withMessages(['current_password' => ['The current password is incorrect.']]);
        }

        $account->forceFill(['password' => $new])->save();
        if ($this->request->hasSession()) {
            $this->request->session()->regenerate();
        }
    }
}
