<?php

namespace App\Modules\Promotions\Domain;

/**
 * One counted (purchasable, in stock) line of a cart or order for the engine.
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
    ) {}
}
