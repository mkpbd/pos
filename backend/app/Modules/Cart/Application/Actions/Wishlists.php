<?php

namespace App\Modules\Cart\Application\Actions;

use App\Modules\Cart\Domain\CartRules;
use App\Modules\Cart\Infrastructure\Models\Wishlist;
use App\Modules\Cart\Infrastructure\Models\WishlistItem;
use App\Modules\OnlineCatalog\Application\Contracts\StorefrontCatalog;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * A signed-in customer's wishlist (guests keep theirs in the browser and merge it after
 * signing in). Entries of products that are no longer live stay stored but are not shown.
 * At most MAX_WISHLIST_ITEMS entries; adding an entry twice changes nothing.
 */
class Wishlists
{
    public function __construct(private readonly StorefrontCatalog $catalog) {}

    /**
     * @return array{items: list<array{id: string, product: array<string, mixed>, variant_id: ?string}>}
     */
    public function list(string $customerId): array
    {
        $wishlist = Wishlist::query()->where('customer_id', $customerId)->first();
        if ($wishlist === null) {
            return ['items' => []];
        }

        $entries = $wishlist->items()->orderByDesc('created_at')->orderByDesc('id')->get();
        $cards = array_column($this->catalog->productCards($entries->pluck('product_id')->unique()->values()->all()), null, 'id');

        $items = [];
        foreach ($entries as $entry) {
            /** @var WishlistItem $entry */
            if (isset($cards[$entry->product_id])) {
                $items[] = ['id' => $entry->id, 'product' => $cards[$entry->product_id], 'variant_id' => $entry->variant_id];
            }
        }

        return ['items' => $items];
    }

    /**
     * @throws ValidationException when the product is not live or the variant is not one of its
     */
    public function add(string $customerId, string $productId, ?string $variantId): void
    {
        if (! $this->isValid($productId, $variantId)) {
            throw ValidationException::withMessages([
                $variantId !== null && $this->isValid($productId, null) ? 'variant_id' : 'product_id' => ['This product is not available.'],
            ]);
        }

        DB::transaction(function () use ($customerId, $productId, $variantId) {
            $wishlist = $this->lock($customerId);
            if ($this->exists($wishlist, $productId, $variantId)) {
                return;
            }
            if ($wishlist->items()->count() >= CartRules::MAX_WISHLIST_ITEMS) {
                throw new BusinessRuleViolation('WISHLIST_FULL', 'Your wishlist is full ('.CartRules::MAX_WISHLIST_ITEMS.' products). Remove something to add more.', ['max_items' => CartRules::MAX_WISHLIST_ITEMS]);
            }
            $wishlist->items()->create(['product_id' => $productId, 'variant_id' => $variantId, 'created_at' => now()]);
        });
    }

    public function remove(string $customerId, string $itemId): void
    {
        DB::transaction(function () use ($customerId, $itemId) {
            $wishlist = Wishlist::query()->where('customer_id', $customerId)->lockForUpdate()->firstOrFail();
            $wishlist->items()->findOrFail($itemId)->delete();
        });
    }

    /**
     * Adds a guest's browser wishlist. Products that are not live, unknown variants and
     * duplicates are skipped; merging stops at the size limit.
     *
     * @param  list<array{product_id: string, variant_id?: ?string}>  $entries
     * @return int entries added
     */
    public function merge(string $customerId, array $entries): int
    {
        $live = array_column($this->catalog->productCards(array_values(array_unique(array_column($entries, 'product_id')))), 'id', 'id');
        $variantIds = array_values(array_filter(array_map(fn (array $e) => $e['variant_id'] ?? null, $entries)));
        $variants = $this->catalog->variantsForCart($variantIds);

        return DB::transaction(function () use ($customerId, $entries, $live, $variants) {
            $wishlist = $this->lock($customerId);
            $count = $wishlist->items()->count();
            $added = 0;
            foreach ($entries as $entry) {
                $productId = $entry['product_id'];
                $variantId = $entry['variant_id'] ?? null;
                if (! isset($live[$productId]) || ($variantId !== null && ($variants[$variantId]['product_id'] ?? null) !== $productId)) {
                    continue;
                }
                if ($count >= CartRules::MAX_WISHLIST_ITEMS) {
                    break;
                }
                if ($this->exists($wishlist, $productId, $variantId)) {
                    continue;
                }
                $wishlist->items()->create(['product_id' => $productId, 'variant_id' => $variantId, 'created_at' => now()]);
                $count++;
                $added++;
            }

            return $added;
        });
    }

    private function isValid(string $productId, ?string $variantId): bool
    {
        if ($this->catalog->productCards([$productId]) === []) {
            return false;
        }

        return $variantId === null || ($this->catalog->variantsForCart([$variantId])[$variantId]['product_id'] ?? null) === $productId;
    }

    private function lock(string $customerId): Wishlist
    {
        return Wishlist::query()->where('customer_id', $customerId)->lockForUpdate()->first()
            ?? Wishlist::query()->create(['customer_id' => $customerId]);
    }

    private function exists(Wishlist $wishlist, string $productId, ?string $variantId): bool
    {
        return $wishlist->items()->where('product_id', $productId)
            ->when($variantId === null, fn ($q) => $q->whereNull('variant_id'), fn ($q) => $q->where('variant_id', $variantId))
            ->exists();
    }
}
