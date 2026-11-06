<?php

namespace App\Modules\AI\Domain\Llm;

/**
 * What a tool returned (JSON text), or the error the model should see when the call was
 * rejected (unknown tool, invalid parameters, branch out of scope).
 */
final readonly class ToolResult
{
    public function __construct(
        public string $toolCallId,
        public string $content,
        public bool $isError = false,
    ) {}
}
