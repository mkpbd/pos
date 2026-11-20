<?php

namespace App\Modules\OnlineCatalog\Domain\Ai;

/**
 * AI2a: turning the model's plain-text answer into listing texts — plain text without markup,
 * cut at a word boundary to the field's limit, and the description built from paragraphs and
 * bullet points (the model never writes HTML).
 */
final class CatalogTextFormat
{
    public const MAX_PARAGRAPHS = 8;

    public const MAX_BULLETS = 12;

    public const PARAGRAPH_MAX = 1500;

    public const BULLET_MAX = 200;

    public const MISSING_INFO_MAX = 5;

    public const MISSING_INFO_ITEM_MAX = 100;

    /**
     * Plain text: tags removed, entities decoded, Markdown emphasis / heading / list markers
     * dropped, whitespace collapsed to single spaces (or, with $keepLines, paragraph breaks kept
     * as blank lines).
     */
    public static function plain(mixed $text, bool $keepLines = false): string
    {
        if (! is_string($text)) {
            return '';
        }
        if ($keepLines) {
            $text = (string) preg_replace('~<\s*(br|/p|/li|/h[1-6]|/div)\s*/?>~i', "\n", $text);
        }
        $text = html_entity_decode(strip_tags($text), ENT_QUOTES | ENT_HTML5, 'UTF-8');
        $text = str_replace(['**', '__', '`'], '', $text);
        $lines = preg_split('/\R/u', $text) ?: [];
        $lines = array_map(fn (string $line) => trim((string) preg_replace(['/^\s*(#{1,6}\s+|[-*•·]\s+)/u', '/[\p{Z}\t]+/u'], ['', ' '], $line)), $lines);
        $lines = array_values(array_filter($lines, fn (string $line) => $line !== ''));

        return $keepLines ? implode("\n", $lines) : implode(' ', $lines);
    }

    /**
     * Cut to $max characters at a word boundary (a hard cut when the first word is longer than
     * half the limit), without an ellipsis; trailing punctuation that would dangle is dropped.
     */
    public static function clamp(string $text, int $max): string
    {
        $text = trim($text);
        if ($max <= 0) {
            return '';
        }
        if (mb_strlen($text) <= $max) {
            return $text;
        }
        $cut = mb_substr($text, 0, $max + 1);
        $space = mb_strrpos($cut, ' ');
        $cut = $space !== false && $space >= (int) floor($max / 2) ? mb_substr($cut, 0, $space) : mb_substr($text, 0, $max);

        // Multibyte-safe (rtrim works on bytes and could cut into a Bangla character).
        return (string) preg_replace('~[\s,;:(/\-–—]+$~u', '', $cut);
    }

    /**
     * @return list<string> non-empty plain items, each clamped, at most $count
     */
    public static function items(mixed $items, int $count, int $max): array
    {
        $result = [];
        foreach (is_array($items) ? array_values($items) : [] as $item) {
            $plain = self::clamp(self::plain($item), $max);
            if ($plain !== '') {
                $result[] = $plain;
            }
            if (count($result) >= $count) {
                break;
            }
        }

        return $result;
    }

    /**
     * `<p>` per paragraph and one `<ul>` of bullets, every text escaped (sanitize afterwards).
     *
     * @param  list<string>  $paragraphs
     * @param  list<string>  $bullets
     */
    public static function html(array $paragraphs, array $bullets): string
    {
        $escape = fn (string $text) => htmlspecialchars($text, ENT_QUOTES | ENT_SUBSTITUTE | ENT_HTML5, 'UTF-8');
        $html = implode('', array_map(fn (string $p) => '<p>'.$escape($p).'</p>', $paragraphs));
        if ($bullets !== []) {
            $html .= '<ul>'.implode('', array_map(fn (string $b) => '<li>'.$escape($b).'</li>', $bullets)).'</ul>';
        }

        return $html;
    }

    /**
     * Plain text with paragraphs separated by a blank line and bullets as "• " lines, within
     * $max characters (whole paragraphs / bullets are dropped from the end; a first paragraph
     * longer than the limit is cut at a word boundary).
     *
     * @param  list<string>  $paragraphs
     * @param  list<string>  $bullets
     */
    public static function plainDescription(array $paragraphs, array $bullets, int $max): string
    {
        $blocks = $paragraphs;
        if ($bullets !== []) {
            $blocks[] = implode("\n", array_map(fn (string $b) => '• '.$b, $bullets));
        }
        $text = '';
        foreach ($blocks as $block) {
            $candidate = $text === '' ? $block : $text."\n\n".$block;
            if (mb_strlen($candidate) <= $max) {
                $text = $candidate;

                continue;
            }
            if ($text === '') {
                $text = self::clamp(str_replace("\n", ' ', $block), $max);
            }
            break;
        }

        return $text;
    }

    /**
     * The model's list of missing facts: plain, unique (case-insensitive), at most five.
     *
     * @return list<string>
     */
    public static function missingInfo(mixed $items): array
    {
        $result = [];
        foreach (self::items($items, 20, self::MISSING_INFO_ITEM_MAX) as $item) {
            $result[mb_strtolower($item)] ??= $item;
        }

        return array_slice(array_values($result), 0, self::MISSING_INFO_MAX);
    }
}
