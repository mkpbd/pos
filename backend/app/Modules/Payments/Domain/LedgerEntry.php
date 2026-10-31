<?php

namespace App\Modules\Payments\Domain;

use App\Modules\Shared\Domain\ValueObjects\Decimal;
use InvalidArgumentException;

/**
 * One amount received (in) or paid out (out) with one method.
 */
final readonly class LedgerEntry
{
    public function __construct(
        public PaymentDirection $direction,
        public PaymentMethod $method,
        /** Positive, currency scale. */
        public string $amount,
        public ?string $customerId = null,
        public ?string $reference = null,
        public ?string $description = null,
    ) {
        if (Decimal::compare($amount, '0') <= 0) {
            throw new InvalidArgumentException('Ledger entry amounts must be positive.');
        }
    }

    /** Effect on the drawer: + for cash in, − for cash out, 0 for anything else. */
    public function cashEffect(): string
    {
        if (! $this->method->isCash()) {
            return '0.00';
        }

        return $this->direction === PaymentDirection::In ? Decimal::round($this->amount, 2) : Decimal::negate($this->amount, 2);
    }
}
