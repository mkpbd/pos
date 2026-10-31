<?php

namespace App\Modules\Cart\Presentation\Http\Controllers;

use App\Modules\Cart\Application\Actions\Wishlists;
use App\Modules\Cart\Domain\CartRules;
use App\Modules\CustomerAccounts\Infrastructure\Models\CustomerAccount;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * The signed-in customer's wishlist. Every response is the list (product cards of live
 * products; entries of hidden products are kept but not shown).
 */
class WishlistController
{
    public function __construct(private readonly Wishlists $wishlists) {}

    /**
     * Wishlist
     */
    public function show(Request $request): JsonResponse
    {
        return ApiResponse::success($this->wishlists->list($this->customerId($request)));
    }

    /**
     * Add to wishlist
     *
     * A live product, optionally one of its variants. Adding it again changes nothing;
     * at most 200 entries (`WISHLIST_FULL`).
     */
    public function store(Request $request): JsonResponse
    {
        $data = $request->validate(['product_id' => ['required', 'uuid'], 'variant_id' => ['sometimes', 'nullable', 'uuid']]);
        $this->wishlists->add($this->customerId($request), $data['product_id'], $data['variant_id'] ?? null);

        return $this->show($request);
    }

    /**
     * Remove from wishlist
     */
    public function destroy(Request $request, string $itemId): JsonResponse
    {
        $this->wishlists->remove($this->customerId($request), $itemId);

        return $this->show($request);
    }

    /**
     * Merge the browser wishlist
     *
     * After signing in, the guest's locally kept entries (at most 100). Entries that are not
     * live or are already listed are skipped.
     */
    public function merge(Request $request): JsonResponse
    {
        $data = $request->validate([
            'items' => ['present', 'array', 'max:'.CartRules::MAX_WISHLIST_MERGE],
            'items.*.product_id' => ['required', 'uuid'],
            'items.*.variant_id' => ['sometimes', 'nullable', 'uuid'],
        ]);
        $this->wishlists->merge($this->customerId($request), array_values($data['items']));

        return $this->show($request);
    }

    private function customerId(Request $request): string
    {
        /** @var CustomerAccount $account */
        $account = $request->user('customer');

        return $account->customer_id;
    }
}
