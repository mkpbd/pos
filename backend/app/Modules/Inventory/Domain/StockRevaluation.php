<?php

namespace App\Modules\Inventory\Domain;

use App\Modules\Shared\Domain\ValueObjects\Decimal;
use InvalidArgumentException;

/**
 * SC3: a value-only cost adjustment of one store × variant × batch level — the quantity
 * stays, the stock value grows by `value` (money, 2 dp), so the weighted average rises.
 */
final readonly class StockRevaluation
{
    public function __construct(
        public string $storeId,
        public string $variantId,
        public ?string $batchId,
        public string $value,
        public MovementType $type = MovementType::LandedCost,
    ) {
        if (! $type->isValueOnly()) {
            throw new InvalidArgumentException('A revaluation needs a value-only movement type.');
        }
        if (Decimal::compare($value, '0') <= 0) {
            throw new InvalidArgumentException('A revaluation adds a positive value.');
        }
    }

    /** Same lock order as StockChange::lockKey(). */
    public function lockKey(): string
    {
        return $this->storeId.'|'.$this->variantId.'|'.($this->batchId ?? '');
    }
}
