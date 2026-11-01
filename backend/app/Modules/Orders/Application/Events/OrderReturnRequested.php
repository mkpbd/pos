<?php

namespace App\Modules\Orders\Application\Events;

/**
 * A customer asked to return goods of a web order (E10b); dispatched after the request committed.
 */
final readonly class OrderReturnRequested
{
    public function __construct(
        public string $organizationId,
        public string $returnId,
    ) {}
}
