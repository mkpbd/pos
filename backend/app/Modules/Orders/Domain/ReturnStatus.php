<?php

namespace App\Modules\Orders\Domain;

use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;

/**
 * Online return lifecycle (E10b):
 *
 *   requested → approved | rejected | cancelled (by the customer)
 *   approved  → received
 *   received  → refunded
 *
 * `refunded`, `rejected` and `cancelled` are final. Rejected and cancelled returns no longer
 * hold any quantity of the order's lines.
 */
enum ReturnStatus: string
{
    case Requested = 'requested';
    case Approved = 'approved';
    case Received = 'received';
    case Refunded = 'refunded';
    case Rejected = 'rejected';
    case Cancelled = 'cancelled';

    public function label(): string
    {
        return match ($this) {
            self::Requested => 'Requested',
            self::Approved => 'Approved',
            self::Received => 'Received',
            self::Refunded => 'Refunded',
            self::Rejected => 'Rejected',
            self::Cancelled => 'Cancelled',
        };
    }

    /**
     * @return list<self>
     */
    public function next(): array
    {
        return match ($this) {
            self::Requested => [self::Approved, self::Rejected, self::Cancelled],
            self::Approved => [self::Received],
            self::Received => [self::Refunded],
            self::Refunded, self::Rejected, self::Cancelled => [],
        };
    }

    /**
     * Whether the return still claims its quantities (and, once refunded, its money).
     */
    public function isActive(): bool
    {
        return ! in_array($this, [self::Rejected, self::Cancelled], true);
    }

    /**
     * @return list<string>
     */
    public static function activeValues(): array
    {
        return array_values(array_map(fn (self $s) => $s->value, array_filter(self::cases(), fn (self $s) => $s->isActive())));
    }

    /**
     * @throws BusinessRuleViolation INVALID_STATUS_TRANSITION
     */
    public function assertCanBecome(self $to, string $number): void
    {
        if (! in_array($to, $this->next(), true)) {
            throw new BusinessRuleViolation(
                'INVALID_STATUS_TRANSITION',
                "{$number} is {$this->label()}; it cannot become {$to->label()}.",
                ['from' => $this->value, 'to' => $to->value, 'allowed' => array_map(fn (self $s) => $s->value, $this->next())],
            );
        }
    }
}
