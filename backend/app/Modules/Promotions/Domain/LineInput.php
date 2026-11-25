<?php

namespace App\Modules\Promotions\Domain;

/**
 * One counted (purchasable, in stock) line of a cart or order for the engine.
 *
 * POS1a: `promotable` false = no product promotion may apply to the line (the till changed
 * its price or gave it a manual discount); `ownDiscount` is such a manual item discount,
 * taken off the line before the order promotion is worked out.
 */
final readonly class LineInput
{
    public function __construct(
        public int|string $key,
        public string $productId,
        public ?string $brandId,
        public ?string $categoryId,
        public string $quantity,
        public string $unitPrice,
        public bool $promotable = true,
        public string $ownDiscount = '0',
    ) {}
}
