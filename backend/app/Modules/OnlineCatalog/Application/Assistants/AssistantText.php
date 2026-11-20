<?php

namespace App\Modules\OnlineCatalog\Application\Assistants;

use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;

/**
 * AI2a: helpers shared by the online store's AI help (category suggestions, bundle ideas):
 * the 422 AI_UNAVAILABLE error for a writer status and plain-text clamping of model answers.
 */
final class AssistantText
{
    public static function unavailable(string $status): BusinessRuleViolation
    {
        $reason = in_array($status, ['disabled', 'budget_exceeded', 'refused', 'empty', 'invalid'], true) ? $status : 'unavailable';
        $message = match ($reason) {
            'disabled' => 'AI help is turned off for your store.',
            'budget_exceeded' => 'Your store has used this month\'s AI budget.',
            'refused' => 'The AI could not help with this. Try other products.',
            'empty', 'invalid' => 'The AI did not give a usable answer. Try again.',
            default => 'AI help is not available right now. Try again later.',
        };

        return new BusinessRuleViolation('AI_UNAVAILABLE', $message, ['reason' => $reason]);
    }

    /**
     * Plain text (tags and Markdown emphasis removed, whitespace collapsed) of at most `$max`
     * characters, cut at a word boundary when one is near, without an ellipsis.
     */
    public static function plain(mixed $text, int $max): string
    {
        if (! is_string($text)) {
            return '';
        }
        $text = html_entity_decode(strip_tags($text), ENT_QUOTES | ENT_HTML5, 'UTF-8');
        $text = trim((string) preg_replace(['/[*_`#]+/u', '/\s+/u'], ['', ' '], $text));
        if (mb_strlen($text) <= $max) {
            return $text;
        }
        $cut = mb_substr($text, 0, $max + 1);
        $space = mb_strrpos($cut, ' ');
        $cut = $space !== false && $space >= (int) ($max * 0.6) ? mb_substr($cut, 0, $space) : mb_substr($text, 0, $max);

        return rtrim($cut, " \t,;:-–—");
    }
}
