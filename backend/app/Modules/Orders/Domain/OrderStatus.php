<?php

namespace App\Modules\Orders\Domain;

use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;

/**
 * Web order lifecycle (ADR-003):
 *
 *   pending_payment → confirmed | cancelled
 *   confirmed       → processing | cancelled
 *   processing      → shipped | cancelled
 *   shipped         → delivered
 *
 * `failed` is reserved for online gateways (E8c); `delivered` and `cancelled` are final.
 */
enum OrderStatus: string
{
    case PendingPayment = 'pending_payment';
    case Confirmed = 'confirmed';
    case Processing = 'processing';
    case Shipped = 'shipped';
    case Delivered = 'delivered';
    case Cancelled = 'cancelled';
    case Failed = 'failed';

    public function label(): string
    {
        return match ($this) {
            self::PendingPayment => 'Awaiting payment',
            self::Confirmed => 'Confirmed',
            self::Processing => 'Processing',
            self::Shipped => 'Shipped',
            self::Delivered => 'Delivered',
            self::Cancelled => 'Cancelled',
            self::Failed => 'Failed',
        };
    }

    /**
     * @return list<self>
     */
    public function next(): array
    {
        return match ($this) {
            self::PendingPayment => [self::Confirmed, self::Cancelled],
            self::Confirmed => [self::Processing, self::Cancelled],
            self::Processing => [self::Shipped, self::Cancelled],
            self::Shipped => [self::Delivered],
            self::Delivered, self::Cancelled, self::Failed => [],
        };
    }

    public function canBecome(self $to): bool
    {
        return in_array($to, $this->next(), true);
    }

    /**
     * @throws BusinessRuleViolation INVALID_STATUS_TRANSITION
     */
    public function assertCanBecome(self $to, string $number): void
    {
        if (! $this->canBecome($to)) {
            throw new BusinessRuleViolation(
                'INVALID_STATUS_TRANSITION',
                "{$number} is {$this->label()}; it cannot become {$to->label()}.",
                ['from' => $this->value, 'to' => $to->value, 'allowed' => array_map(fn (self $s) => $s->value, $this->next())],
            );
        }
    }
}
