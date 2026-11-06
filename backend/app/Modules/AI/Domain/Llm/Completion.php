<?php

namespace App\Modules\AI\Domain\Llm;

/**
 * The model's reply: the assistant message (append it to the conversation as is), why it
 * stopped, the tokens used and the model that answered.
 */
final readonly class Completion
{
    public function __construct(
        public Message $message,
        public StopReason $stopReason,
        public Usage $usage,
        public string $model,
    ) {}

    public function text(): string
    {
        return $this->message->text();
    }

    /**
     * @return list<ToolCall>
     */
    public function toolCalls(): array
    {
        return $this->message->toolCalls();
    }
}
