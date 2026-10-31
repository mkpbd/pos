<?php

namespace App\Modules\Shared\Domain\Exceptions;

use DomainException;

/**
 * Thrown when a domain invariant is violated (insufficient stock, credit limit exceeded, ...).
 * Rendered as HTTP 422 (or $status, e.g. 409 for a stale client view) with the machine-readable $errorCode.
 */
class BusinessRuleViolation extends DomainException
{
    /**
     * @param  array<string, mixed>  $details
     */
    public function __construct(
        public readonly string $errorCode,
        string $message,
        public readonly array $details = [],
        public readonly int $status = 422,
    ) {
        parent::__construct($message);
    }
}
