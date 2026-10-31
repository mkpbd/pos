<?php

namespace App\Modules\CustomerAccounts\Presentation\Http\Controllers;

use App\Modules\CustomerAccounts\Application\Actions\ChangeAccountStatus;
use App\Modules\CustomerAccounts\Domain\AccountStatus;
use App\Modules\CustomerAccounts\Infrastructure\EloquentCustomerOnlineAccounts;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class CustomerAccountAdminController
{
    /**
     * Enable or disable online sign-in
     *
     * `status`: `active` or `disabled`. A disabled shopper is signed out on their next request.
     * Returns the customer's `online_account`; 404 when the customer has no store account.
     */
    public function update(Request $request, string $customerId, ChangeAccountStatus $change): JsonResponse
    {
        $status = $request->validate(['status' => ['required', Rule::enum(AccountStatus::class)]])['status'];

        return ApiResponse::success(EloquentCustomerOnlineAccounts::present($change($customerId, AccountStatus::from($status))));
    }
}
