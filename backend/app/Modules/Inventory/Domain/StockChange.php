<?php

namespace App\Modules\Inventory\Domain;

use App\Modules\Shared\Domain\ValueObjects\Decimal;
use InvalidArgumentException;

/**
 * One requested quantity change of a store × variant × batch.
 * Quantity is positive; the movement type decides the direction.
 */
final readonly class StockChange
{
    public function __construct(
        public string $storeId,
        public string $variantId,
        public ?string $batchId,
        public MovementType $type,
        public string $quantity,
        /** Required for inbound changes; outbound changes use the current average cost. */
        public ?string $unitCost = null,
    ) {
        if (Decimal::compare($quantity, '0') <= 0) {
            throw new InvalidArgumentException('Stock change quantity must be positive.');
        }
        if ($type->isInbound() && $unitCost === null) {
            throw new InvalidArgumentException('Inbound stock changes need a unit cost.');
        }
    }

    public function signedQuantity(): string
    {
        return $this->type->isInbound() ? Decimal::round($this->quantity, 3) : Decimal::negate($this->quantity, 3);
    }

    /** Lock-ordering key: every caller locks rows in this order, which rules out deadlocks. */
    public function lockKey(): string
    {
        return $this->storeId.'|'.$this->variantId.'|'.($this->batchId ?? '');
    }
}
