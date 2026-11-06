<?php

namespace App\Modules\AI\Domain\Contracts;

use App\Modules\AI\Domain\Exceptions\AiUnavailable;
use App\Modules\AI\Domain\Llm\Completion;
use App\Modules\AI\Domain\Llm\CompletionOptions;
use App\Modules\AI\Domain\Llm\Conversation;
use App\Modules\AI\Domain\Llm\ToolDefinition;

/**
 * The only way business code talks to a language model (provider-independent). Implementations:
 * AnthropicLanguageModel (Claude Messages API over HTTP), NullLanguageModel (AI disabled) and
 * FakeLanguageModel (tests).
 */
interface LanguageModel
{
    /**
     * One model call. The caller runs tools and loops; the returned message must be appended to
     * the conversation unchanged before the tool results.
     *
     * @param  list<ToolDefinition>  $tools
     *
     * @throws AiUnavailable when the provider cannot answer (disabled, timeout, errors after retries)
     */
    public function complete(Conversation $conversation, array $tools, CompletionOptions $options): Completion;

    /** The model id requests go to (for usage records). */
    public function model(): string;
}
