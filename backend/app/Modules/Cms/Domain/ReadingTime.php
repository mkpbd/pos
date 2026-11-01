<?php

namespace App\Modules\Cms\Domain;

/**
 * Estimated reading time of a post body: words of its text at 200 words a minute,
 * rounded up, at least one minute.
 */
final class ReadingTime
{
    public const WORDS_PER_MINUTE = 200;

    public static function minutes(?string $html): int
    {
        $text = html_entity_decode(strip_tags(str_replace('<', ' <', (string) $html)), ENT_QUOTES | ENT_HTML5, 'UTF-8');
        $words = preg_split('/\s+/u', trim($text), -1, PREG_SPLIT_NO_EMPTY) ?: [];

        return max(1, (int) ceil(count($words) / self::WORDS_PER_MINUTE));
    }
}
