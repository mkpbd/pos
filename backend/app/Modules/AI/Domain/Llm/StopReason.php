<?php

namespace App\Modules\AI\Domain\Llm;

enum StopReason: string
{
    /** The model finished its answer. */
    case EndTurn = 'end_turn';
    /** The model wants tool results before it continues. */
    case ToolUse = 'tool_use';
    /** The answer was cut off at the response size limit. */
    case MaxTokens = 'max_tokens';
    /** The provider's safety systems declined the request. */
    case Refusal = 'refusal';
    case Other = 'other';
}
