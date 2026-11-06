<?php

namespace App\Modules\Purchasing\Domain\Reorder;

/**
 * Everything the reorder calculator needs for one variant in one store. Quantities are
 * decimal strings; `sold` is net units sold over `velocityDays`. `sourceSurplus` is what the
 * central source store can spare (null when there is no source to transfer from).
 */
final readonly class ReorderInput
{
    public function __construct(
        public string $onHand,
        public string $onOrder,
        public string $inTransit,
        public string $sold,
        public int $velocityDays,
        public string $minQty,
        public ?string $maxQty,
        public int $leadTimeDays,
        public int $safetyDays,
        public int $coverageDays,
        public string $packSize = '1',
        public ?string $minOrderQty = null,
        public bool $wholeUnits = true,
        public ?string $sourceSurplus = null,
    ) {}
}
