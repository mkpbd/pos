<?php

namespace App\Modules\AI\Domain\Llm;

/**
 * The model asks to run one tool with these arguments (already JSON-decoded).
 */
final readonly class ToolCall
{
    /**
     * @param  array<string, mixed>  $input
     */
    public function __construct(
        public string $id,
        public string $name,
        public array $input,
    ) {}
}
