<?php

namespace App\Modules\Payments\Domain;

/**
 * The document a ledger entry belongs to (a sale, a return, an expense, …).
 */
final readonly class PaymentSource
{
    public function __construct(
        public string $type,
        public ?string $id = null,
        public ?string $number = null,
    ) {}
}
