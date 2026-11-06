<?php

namespace App\Modules\AI\Infrastructure\Providers;

use App\Modules\AI\Domain\Contracts\LanguageModel;
use App\Modules\AI\Domain\Exceptions\AiUnavailable;
use App\Modules\AI\Domain\Llm\Completion;
use App\Modules\AI\Domain\Llm\CompletionOptions;
use App\Modules\AI\Domain\Llm\Conversation;

/**
 * Bound when AI is disabled or no provider is configured: every call is 503 AI_UNAVAILABLE.
 */
final class NullLanguageModel implements LanguageModel
{
    public function __construct(private readonly string $reason = 'disabled') {}

    public function complete(Conversation $conversation, array $tools, CompletionOptions $options): Completion
    {
        throw new AiUnavailable($this->reason, $this->reason === 'disabled'
            ? 'AI features are turned off.'
            : 'No AI provider is configured.');
    }

    public function model(): string
    {
        return 'none';
    }

    public function reason(): string
    {
        return $this->reason;
    }
}
