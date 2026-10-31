<?php

namespace App\Modules\Cart\Application\Actions;

use App\Modules\Cart\Domain\CartOwner;
use App\Modules\Cart\Domain\CartRules;
use App\Modules\Cart\Infrastructure\Models\Cart;
use App\Modules\Cart\Infrastructure\Models\CartItem;
use App\Modules\OnlineCatalog\Application\Contracts\StorefrontCatalog;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Shared\Domain\ValueObjects\Decimal;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Changes to the current visitor's cart. Every change runs in a transaction with the cart
 * row locked; the cart is created on the first add (a guest then gets a new cookie token).
 *
 * Adding or changing a quantity checks the live catalog: the variant must be purchasable
 * (VARIANT_NOT_PURCHASABLE), in stock (OUT_OF_STOCK) and the line may not exceed what the
 * fulfilment store has (INSUFFICIENT_STOCK, details.max_quantity). Whole units only unless
 * the unit allows decimals; at most 999 per line and 50 lines (CART_FULL).
 */
class ShoppingCart
{
    public function __construct(private readonly StorefrontCatalog $catalog) {}

    public function find(CartOwner $owner): ?Cart
    {
        return $this->query($owner)?->first();
    }

    /**
     * @return array{0: Cart, 1: ?string} the cart and, when a guest cart was created, its new cookie token
     */
    public function add(CartOwner $owner, string $variantId, string $quantity): array
    {
        $quantity = Decimal::round($quantity, 3);
        $variant = $this->catalog->variantsForCart([$variantId])[$variantId] ?? null;

        return DB::transaction(function () use ($owner, $variantId, $quantity, $variant) {
            [$cart, $token] = $this->lockOrCreate($owner);
            /** @var CartItem|null $line */
            $line = $cart->items()->where('variant_id', $variantId)->first();
            if ($line === null && $cart->items()->count() >= CartRules::MAX_LINES) {
                throw new BusinessRuleViolation('CART_FULL', 'Your cart is full ('.CartRules::MAX_LINES.' different products). Remove something to add more.', ['max_lines' => CartRules::MAX_LINES]);
            }

            $total = $line === null ? $quantity : Decimal::add((string) $line->quantity, $quantity, 3);
            $this->assertQuantity($variant, $total, $line === null ? '0' : (string) $line->quantity);

            if ($line === null) {
                $cart->items()->create(['variant_id' => $variantId, 'quantity' => $total]);
            } else {
                $line->update(['quantity' => $total]);
            }
            $this->touch($cart);

            return [$cart, $token];
        });
    }

    public function update(CartOwner $owner, string $itemId, string $quantity): Cart
    {
        $quantity = Decimal::round($quantity, 3);

        return DB::transaction(function () use ($owner, $itemId, $quantity) {
            $cart = $this->lockExisting($owner);
            /** @var CartItem $line */
            $line = $cart->items()->findOrFail($itemId);
            $variant = $this->catalog->variantsForCart([$line->variant_id])[$line->variant_id] ?? null;
            $this->assertQuantity($variant, $quantity, '0');

            $line->update(['quantity' => $quantity]);
            $this->touch($cart);

            return $cart;
        });
    }

    public function remove(CartOwner $owner, string $itemId): Cart
    {
        return DB::transaction(function () use ($owner, $itemId) {
            $cart = $this->lockExisting($owner);
            $cart->items()->findOrFail($itemId)->delete();
            $this->touch($cart);

            return $cart;
        });
    }

    public function clear(CartOwner $owner): void
    {
        DB::transaction(function () use ($owner) {
            $this->query($owner)?->lockForUpdate()->first()?->delete();
        });
    }

    /**
     * Moves a guest cart's lines into the customer's cart: quantities are summed and capped
     * at what the fulfilment store has (and 999); lines beyond the 50-line limit are left out
     * and count as capped. The guest cart is deleted.
     *
     * @return array{merged_lines: int, capped_lines: int}
     */
    public function merge(string $guestToken, string $customerId): array
    {
        return DB::transaction(function () use ($guestToken, $customerId) {
            $guest = $this->query(CartOwner::guest($guestToken))?->lockForUpdate()->first();
            if ($guest === null) {
                return ['merged_lines' => 0, 'capped_lines' => 0];
            }

            [$cart] = $this->lockOrCreate(CartOwner::customer($customerId));
            $guestLines = $guest->items()->orderBy('created_at')->orderBy('id')->get();
            $existing = $cart->items()->get()->keyBy('variant_id');
            $variants = $this->catalog->variantsForCart($guestLines->pluck('variant_id')->all());

            $merged = 0;
            $capped = 0;
            foreach ($guestLines as $guestLine) {
                /** @var CartItem $guestLine */
                $line = $existing->get($guestLine->variant_id);
                if ($line === null && $existing->count() >= CartRules::MAX_LINES) {
                    $capped++;

                    continue;
                }

                $max = $variants[$guestLine->variant_id]['max_quantity'] ?? null;
                [$quantity, $wasCapped] = CartRules::merged($line === null ? '0' : (string) $line->quantity, (string) $guestLine->quantity, $max);
                if ($line === null) {
                    $existing->put($guestLine->variant_id, $cart->items()->create(['variant_id' => $guestLine->variant_id, 'quantity' => $quantity]));
                } else {
                    $line->update(['quantity' => $quantity]);
                }
                $merged++;
                $capped += $wasCapped ? 1 : 0;
            }

            $guest->delete();
            $this->touch($cart);

            return ['merged_lines' => $merged, 'capped_lines' => $capped];
        });
    }

    /**
     * @param  array<string, mixed>|null  $variant  catalog data of the line's variant
     */
    private function assertQuantity(?array $variant, string $quantity, string $alreadyInCart): void
    {
        if ($variant === null || ! $variant['purchasable']) {
            throw new BusinessRuleViolation('VARIANT_NOT_PURCHASABLE', 'This product is not available for sale.');
        }
        if (! $variant['in_stock']) {
            throw new BusinessRuleViolation('OUT_OF_STOCK', 'This product is out of stock.');
        }
        if (! $variant['allow_decimal'] && ! Decimal::isWhole($quantity)) {
            throw ValidationException::withMessages(['quantity' => ['This product is sold in whole units.']]);
        }
        if (Decimal::compare($quantity, CartRules::MAX_QUANTITY) > 0) {
            throw ValidationException::withMessages(['quantity' => ['You can order at most '.CartRules::MAX_QUANTITY.' of a product.']]);
        }
        $max = $variant['max_quantity'];
        if ($max !== null && Decimal::compare($quantity, $max) > 0) {
            throw new BusinessRuleViolation(
                'INSUFFICIENT_STOCK',
                'Only '.CartRules::display($max).' available.',
                ['max_quantity' => $max, 'in_cart' => CartRules::display($alreadyInCart)],
            );
        }
    }

    /**
     * @return Builder<Cart>|null null for a guest without a token
     */
    private function query(CartOwner $owner): ?Builder
    {
        if (! $owner->isGuest()) {
            return Cart::query()->where('customer_id', $owner->customerId);
        }
        if ($owner->guestToken === null) {
            return null;
        }

        return Cart::query()
            ->whereNull('customer_id')
            ->where('token_hash', CartOwner::hashToken($owner->guestToken))
            ->where('expires_at', '>', now());
    }

    /**
     * @return array{0: Cart, 1: ?string}
     */
    private function lockOrCreate(CartOwner $owner): array
    {
        $cart = $this->query($owner)?->lockForUpdate()->first();
        if ($cart !== null) {
            return [$cart, null];
        }

        if (! $owner->isGuest()) {
            return [Cart::query()->create(['customer_id' => $owner->customerId]), null];
        }

        $token = CartOwner::newToken();

        return [Cart::query()->create([
            'token_hash' => CartOwner::hashToken($token),
            'expires_at' => now()->addDays(CartRules::GUEST_TTL_DAYS),
        ]), $token];
    }

    private function lockExisting(CartOwner $owner): Cart
    {
        $cart = $this->query($owner)?->lockForUpdate()->first();
        if ($cart === null) {
            throw (new ModelNotFoundException)->setModel(CartItem::class);
        }

        return $cart;
    }

    private function touch(Cart $cart): void
    {
        $cart->forceFill(['expires_at' => $cart->customer_id === null ? now()->addDays(CartRules::GUEST_TTL_DAYS) : null])->save();
        $cart->touch();
    }
}
