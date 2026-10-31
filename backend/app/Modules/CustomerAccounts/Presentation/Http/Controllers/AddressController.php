<?php

namespace App\Modules\CustomerAccounts\Presentation\Http\Controllers;

use App\Modules\CustomerAccounts\Infrastructure\Models\CustomerAccount;
use App\Modules\CustomerAccounts\Presentation\Http\Requests\SaveAddressRequest;
use App\Modules\Customers\Application\Actions\CustomerAddressBook;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * The signed-in shopper's saved addresses (kept by the Customers module). Another
 * customer's address id is 404.
 */
class AddressController
{
    /**
     * Addresses
     *
     * Default shipping address first, then newest first.
     */
    public function index(Request $request, CustomerAddressBook $book): JsonResponse
    {
        return ApiResponse::success($book->list($this->customerId($request)));
    }

    /**
     * Add an address
     *
     * Phone: Bangladeshi mobile (stored as 01XXXXXXXXX). The district must be in the division.
     * The first address becomes the default; at most 10 (`ADDRESS_LIMIT_REACHED`).
     */
    public function store(SaveAddressRequest $request, CustomerAddressBook $book): JsonResponse
    {
        return ApiResponse::created($book->create($this->customerId($request), $request->addressData()));
    }

    /**
     * Change an address
     *
     * Any subset of the fields. `is_default_shipping: true` makes it the default (the default
     * can only move to another address, not be switched off).
     */
    public function update(SaveAddressRequest $request, string $addressId, CustomerAddressBook $book): JsonResponse
    {
        return ApiResponse::success($book->update($this->customerId($request), $addressId, $request->addressData()));
    }

    /**
     * Delete an address
     *
     * Deleting the default promotes the most recent remaining address.
     */
    public function destroy(Request $request, string $addressId, CustomerAddressBook $book): JsonResponse
    {
        $book->delete($this->customerId($request), $addressId);

        return ApiResponse::noContent();
    }

    private function customerId(Request $request): string
    {
        /** @var CustomerAccount $account */
        $account = $request->user('customer');

        return $account->customer_id;
    }
}
