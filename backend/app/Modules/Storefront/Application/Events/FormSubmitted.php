<?php

namespace App\Modules\Storefront\Application\Events;

use Illuminate\Contracts\Events\ShouldDispatchAfterCommit;

/**
 * B8b: a visitor sent a builder form (dispatched after the submission is committed).
 * `notifyEmail` is the form's extra recipient at the time of sending (null: none).
 */
final readonly class FormSubmitted implements ShouldDispatchAfterCommit
{
    public function __construct(
        public string $organizationId,
        public string $submissionId,
        public ?string $notifyEmail,
    ) {}
}
