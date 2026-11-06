<?php

namespace App\Modules\AI\Domain\Llm;

/**
 * A tool the model may call: a name ([a-z0-9_], ≤ 64), what it does, and a JSON schema of its
 * arguments (an object schema).
 */
final readonly class ToolDefinition
{
    /**
     * @param  array<string, mixed>  $inputSchema
     */
    public function __construct(
        public string $name,
        public string $description,
        public array $inputSchema,
    ) {}
}
