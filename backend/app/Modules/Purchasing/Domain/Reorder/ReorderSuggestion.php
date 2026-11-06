<?php

namespace App\Modules\Purchasing\Domain\Reorder;

use App\Modules\Shared\Domain\ValueObjects\Decimal;

/**
 * The calculator's answer for one variant in one store. Quantities have 3 decimals,
 * `avgDaily` 3 decimals, `daysOfCover` 1 decimal (null without sales).
 */
final readonly class ReorderSuggestion
{
    public function __construct(
        public string $avgDaily,
        public string $reorderPoint,
        public string $target,
        public string $available,
        public bool $needsReorder,
        public string $suggestedTransfer,
        public string $suggestedPurchase,
        public ?ReorderReason $reason,
        public ?string $daysOfCover,
    ) {}

    /** Whether anything should be transferred or bought. */
    public function hasSuggestion(): bool
    {
        return Decimal::compare($this->suggestedTransfer, '0') > 0 || Decimal::compare($this->suggestedPurchase, '0') > 0;
    }
}
