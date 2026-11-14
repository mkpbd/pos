<?php

namespace App\Modules\Reviews\Application\Events;

use Illuminate\Contracts\Events\ShouldDispatchAfterCommit;

/**
 * P1b: a question's answer was published for the first time (dispatched after commit): the asker
 * gets one e-mail with the answer.
 */
final readonly class ProductQuestionAnswered implements ShouldDispatchAfterCommit
{
    public function __construct(
        public string $organizationId,
        public string $questionId,
    ) {}
}
