<?php

namespace App\Modules\Shared\Domain;

/**
 * Plain text from (sanitized) rich text, for search snippets and structured data.
 */
final class PlainText
{
    /**
     * Tags removed, entities decoded, whitespace collapsed; null when nothing is left.
     */
    public static function fromHtml(?string $html): ?string
    {
        if ($html === null) {
            return null;
        }
        // Block ends become spaces so "<p>a</p><p>b</p>" does not read "ab".
        $text = strip_tags((string) preg_replace('#<(br|/p|/h[1-6]|/li|/td|/th|/blockquote|/figcaption)\b[^>]*>#i', ' $0', $html));
        $text = html_entity_decode($text, ENT_QUOTES | ENT_HTML5, 'UTF-8');
        $text = trim((string) preg_replace('/\s+/u', ' ', $text));

        return $text === '' ? null : $text;
    }

    /**
     * At most $max characters, cut at a word boundary with an ellipsis when shortened.
     */
    public static function excerpt(?string $html, int $max): ?string
    {
        $text = self::fromHtml($html);
        if ($text === null || mb_strlen($text) <= $max) {
            return $text;
        }
        $cut = mb_substr($text, 0, $max - 1);
        $space = mb_strrpos($cut, ' ');
        if ($space !== false && $space > $max / 2) {
            $cut = mb_substr($cut, 0, $space);
        }

        return rtrim($cut, ' ,.;:-').'…';
    }
}
