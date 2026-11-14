<?php

namespace App\Modules\Reviews\Application\Events;

use Illuminate\Contracts\Events\ShouldDispatchAfterCommit;

/**
 * P1b: a shopper asked a question about a product (dispatched after it is committed): staff who
 * moderate reviews get an inbox notification.
 */
final readonly class ProductQuestionAsked implements ShouldDispatchAfterCommit
{
    public function __construct(
        public string $organizationId,
        public string $questionId,
    ) {}
}
