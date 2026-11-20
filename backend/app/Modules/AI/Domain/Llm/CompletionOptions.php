<?php

namespace App\Modules\AI\Domain\Llm;

/**
 * Per-call options. `allowTools` false keeps the tool definitions in the request (the
 * conversation may contain earlier tool calls) but asks for a final answer without tools.
 *
 * AI2a: `outputSchema` asks for a JSON answer that follows the schema (structured output; the
 * schema must use `additionalProperties: false` and list every property in `required` on every
 * object, and no length / range constraints — clamp on the server instead). `effort` overrides
 * the configured effort for this call.
 */
final readonly class CompletionOptions
{
    /**
     * @param  array<string, mixed>|null  $outputSchema
     */
    public function __construct(
        public ?int $maxTokens = null,
        public bool $allowTools = true,
        public ?array $outputSchema = null,
        public ?string $effort = null,
    ) {}
}
