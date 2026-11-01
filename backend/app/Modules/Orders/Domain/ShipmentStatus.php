<?php

namespace App\Modules\Orders\Domain;

use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;

/**
 * Where a parcel is (E10a):
 *
 *   handed_over → in_transit | delivered | returned
 *   in_transit  → in_transit | delivered | returned   (several transit updates are fine)
 *
 * `delivered` and `returned` (to the sender: refused or undeliverable) are final.
 */
enum ShipmentStatus: string
{
    case HandedOver = 'handed_over';
    case InTransit = 'in_transit';
    case Delivered = 'delivered';
    case Returned = 'returned';

    public function label(): string
    {
        return match ($this) {
            self::HandedOver => 'Handed to courier',
            self::InTransit => 'In transit',
            self::Delivered => 'Delivered',
            self::Returned => 'Returned to sender',
        };
    }

    /**
     * @return list<self>
     */
    public function next(): array
    {
        return match ($this) {
            self::HandedOver, self::InTransit => [self::InTransit, self::Delivered, self::Returned],
            self::Delivered, self::Returned => [],
        };
    }

    public function isFinal(): bool
    {
        return $this->next() === [];
    }

    /**
     * @throws BusinessRuleViolation INVALID_STATUS_TRANSITION
     */
    public function assertCanBecome(self $to, string $number): void
    {
        if (! in_array($to, $this->next(), true)) {
            throw new BusinessRuleViolation(
                'INVALID_STATUS_TRANSITION',
                "The parcel of {$number} is {$this->label()}; it cannot become {$to->label()}.",
                ['from' => $this->value, 'to' => $to->value, 'allowed' => array_map(fn (self $s) => $s->value, $this->next())],
            );
        }
    }
}
