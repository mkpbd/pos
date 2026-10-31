<?php

namespace App\Modules\CustomerAccounts\Infrastructure;

use App\Modules\CustomerAccounts\Infrastructure\Models\CustomerAccount;
use App\Modules\Customers\Application\Contracts\CustomerOnlineAccounts;

class EloquentCustomerOnlineAccounts implements CustomerOnlineAccounts
{
    public function forCustomer(string $customerId): ?array
    {
        $account = CustomerAccount::query()->where('customer_id', $customerId)->first();

        return $account === null ? null : self::present($account);
    }

    /**
     * @return array{email: string, email_verified_at: ?string, last_login_at: ?string, status: string, created_at: ?string}
     */
    public static function present(CustomerAccount $account): array
    {
        return [
            'email' => $account->email,
            'email_verified_at' => $account->email_verified_at?->toIso8601String(),
            'last_login_at' => $account->last_login_at?->toIso8601String(),
            'status' => $account->status->value,
            'created_at' => $account->created_at?->toIso8601String(),
        ];
    }
}
