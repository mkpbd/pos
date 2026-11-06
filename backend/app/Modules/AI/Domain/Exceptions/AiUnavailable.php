<?php

namespace App\Modules\AI\Domain\Exceptions;

use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;

/**
 * The AI provider cannot be used: AI is disabled for the application or the organization, or
 * the provider failed (timeout, errors after retries, rejected request). Rendered as
 * 503 AI_UNAVAILABLE; `reason` is a short machine code kept in the usage log.
 */
final class AiUnavailable extends BusinessRuleViolation
{
    public function __construct(public readonly string $reason, string $message = 'AI features are not available right now.')
    {
        parent::__construct('AI_UNAVAILABLE', $message, ['reason' => $reason], 503);
    }

    public static function disabled(): self
    {
        return new self('disabled', 'AI features are turned off for this organization.');
    }
}
