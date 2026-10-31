<?php

namespace App\Modules\Promotions\Domain;

use DateTimeInterface;

/**
 * A promotion as the engine sees it. Targets are already resolved: product ids, category
 * ids including every sub-category, or brand ids (empty for the order scope).
 */
final readonly class Offer
{
    /** @var array<string, true> */
    private array $targets;

    /**
     * @param  list<string>  $targetIds
     */
    public function __construct(
        public string $id,
        public string $name,
        public PromotionType $type,
        public string $value,
        public PromotionScope $scope,
        array $targetIds = [],
        public ?string $minSubtotal = null,
        public ?string $maxDiscount = null,
        public ?DateTimeInterface $startsAt = null,
        public ?DateTimeInterface $endsAt = null,
        public bool $isCoupon = false,
        public bool $showCountdown = false,
    ) {
        $this->targets = array_fill_keys($targetIds, true);
    }

    public function isLive(DateTimeInterface $now): bool
    {
        return ($this->startsAt === null || $this->startsAt <= $now) && ($this->endsAt === null || $now < $this->endsAt);
    }

    public function matches(LineInput $line): bool
    {
        return match ($this->scope) {
            PromotionScope::Order => true,
            PromotionScope::Products => isset($this->targets[$line->productId]),
            PromotionScope::Categories => $line->categoryId !== null && isset($this->targets[$line->categoryId]),
            PromotionScope::Brands => $line->brandId !== null && isset($this->targets[$line->brandId]),
        };
    }

    /**
     * @return list<string>
     */
    public function targetIds(): array
    {
        return array_map('strval', array_keys($this->targets));
    }

    /**
     * Tie-break between two offers giving the same discount: the one ending first (open
     * ended last), then the smaller id. Negative when $this goes first.
     */
    public function tieBreak(self $other): int
    {
        $a = $this->endsAt?->getTimestamp() ?? PHP_INT_MAX;
        $b = $other->endsAt?->getTimestamp() ?? PHP_INT_MAX;

        return $a <=> $b ?: strcmp($this->id, $other->id);
    }
}
