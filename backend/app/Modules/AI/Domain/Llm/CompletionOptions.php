<?php

namespace App\Modules\AI\Domain\Llm;

/**
 * Per-call options. `allowTools` false keeps the tool definitions in the request (the
 * conversation may contain earlier tool calls) but asks for a final answer without tools.
 */
final readonly class CompletionOptions
{
    public function __construct(
        public ?int $maxTokens = null,
        public bool $allowTools = true,
    ) {}
}
