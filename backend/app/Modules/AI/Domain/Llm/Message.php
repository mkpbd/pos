<?php

namespace App\Modules\AI\Domain\Llm;

use InvalidArgumentException;

/**
 * One turn of a conversation: the user (questions, tool results) or the assistant (text, tool
 * calls and provider-specific blocks that must be sent back unchanged, such as thinking).
 */
final readonly class Message
{
    public const USER = 'user';

    public const ASSISTANT = 'assistant';

    /**
     * @param  list<TextBlock|ToolCall|ToolResult|ProviderBlock>  $content
     */
    public function __construct(public string $role, public array $content)
    {
        if (! in_array($role, [self::USER, self::ASSISTANT], true)) {
            throw new InvalidArgumentException("Unknown role [{$role}].");
        }
    }

    public static function user(string $text): self
    {
        return new self(self::USER, [new TextBlock($text)]);
    }

    public static function assistant(string $text): self
    {
        return new self(self::ASSISTANT, [new TextBlock($text)]);
    }

    /**
     * @param  list<ToolResult>  $results
     */
    public static function toolResults(array $results): self
    {
        return new self(self::USER, $results);
    }

    /** The concatenated text blocks. */
    public function text(): string
    {
        $parts = [];
        foreach ($this->content as $block) {
            if ($block instanceof TextBlock && trim($block->text) !== '') {
                $parts[] = $block->text;
            }
        }

        return trim(implode("\n\n", $parts));
    }

    /**
     * @return list<ToolCall>
     */
    public function toolCalls(): array
    {
        return array_values(array_filter($this->content, fn ($block) => $block instanceof ToolCall));
    }
}
