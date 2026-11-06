<?php

namespace App\Modules\AI\Domain\Llm;

/**
 * Tokens a call consumed (input includes cached prompt tokens read or written).
 */
final readonly class Usage
{
    public function __construct(
        public int $inputTokens = 0,
        public int $outputTokens = 0,
    ) {}

    public function add(self $other): self
    {
        return new self($this->inputTokens + $other->inputTokens, $this->outputTokens + $other->outputTokens);
    }

    public function total(): int
    {
        return $this->inputTokens + $this->outputTokens;
    }

    /**
     * @return array{input_tokens: int, output_tokens: int}
     */
    public function toArray(): array
    {
        return ['input_tokens' => $this->inputTokens, 'output_tokens' => $this->outputTokens];
    }
}
