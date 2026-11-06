<?php

namespace App\Modules\AI\Domain\Llm;

/**
 * A system prompt and the turns so far. Immutable: with() returns a longer conversation.
 */
final readonly class Conversation
{
    /**
     * @param  list<Message>  $messages
     */
    public function __construct(
        public string $system,
        public array $messages = [],
    ) {}

    public function with(Message $message): self
    {
        return new self($this->system, [...$this->messages, $message]);
    }
}
