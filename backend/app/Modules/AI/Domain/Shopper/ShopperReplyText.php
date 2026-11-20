<?php

namespace App\Modules\AI\Domain\Shopper;

/**
 * AI2b output safety for the shopper assistant's reply text (pure).
 *
 * The model's text is never trusted with links: HTML tags are removed, markdown images become
 * their alt text, a markdown link stays only when it points to a product the tools returned
 * (`/product/<slug>`) or an own-store path the tools returned — any other link keeps only its
 * label — and bare URLs (`https://…`, `www.…`, `javascript:`, `data:`, …) are removed. The
 * hand-off marker `[[handoff]]` the prompt asks for is taken out and reported.
 */
final class ShopperReplyText
{
    public const MAX_LENGTH = 2000;

    public const HANDOFF_MARKER = '[[handoff]]';

    private const LINK = '/(!?)\[([^\[\]\n]{1,200})\]\(\s*<?([^()\s<>]{1,500})>?(?:\s+"[^"\n]*")?\s*\)/u';

    private const SLUG = '[\p{L}\p{N}-]{1,200}';

    /**
     * The product slugs the text links to (`/product/<slug>`, lowercase, in order).
     *
     * @return list<string>
     */
    public static function linkedSlugs(string $text): array
    {
        $slugs = [];
        if (preg_match_all(self::LINK, $text, $matches, PREG_SET_ORDER) !== false) {
            foreach ($matches as $m) {
                $slug = self::productSlug($m[3]);
                if ($m[1] === '' && $slug !== null) {
                    $slugs[] = $slug;
                }
            }
        }

        return array_values(array_unique($slugs));
    }

    /**
     * @param  list<string>  $knownSlugs  lowercase product slugs the tools returned (and that are live)
     * @param  list<string>  $knownPaths  own-store paths the tools returned
     * @return array{text: string, slugs: list<string>, paths: list<string>, handoff: bool}
     */
    public static function clean(string $text, array $knownSlugs, array $knownPaths): array
    {
        // The placeholder characters below are private-use: never accepted from the model.
        $text = str_replace(["\u{E000}", "\u{E001}", "\0"], '', $text);
        $handoff = false;
        if (stripos($text, self::HANDOFF_MARKER) !== false) {
            $handoff = true;
            $text = str_ireplace(self::HANDOFF_MARKER, '', $text);
        }

        // HTML tags (and <https://…> autolinks) — a lone "<" in "under < 500" stays.
        $text = (string) preg_replace('/<\/?[a-zA-Z!][^<>]*>/u', '', $text);

        $slugs = [];
        $paths = [];
        $kept = [];
        $nonce = bin2hex(random_bytes(6));
        $text = (string) preg_replace_callback(self::LINK, function (array $m) use ($knownSlugs, $knownPaths, $nonce, &$slugs, &$paths, &$kept) {
            $label = trim($m[2]);
            if ($m[1] === '!') {
                return $label;
            }
            $url = $m[3];
            $slug = self::productSlug($url);
            if ($slug !== null && in_array($slug, $knownSlugs, true)) {
                $slugs[] = $slug;

                return self::keep($kept, $nonce, '['.$label.'](/product/'.$slug.')');
            }
            if ($slug === null && in_array($url, $knownPaths, true)) {
                $paths[] = $url;

                return self::keep($kept, $nonce, '['.$label.']('.$url.')');
            }

            return $label;
        }, $text);

        // Whatever still looks like a markdown link (malformed, unterminated, nested parentheses)
        // keeps only its label.
        $text = (string) preg_replace('/!?\[([^\[\]\n]{0,200})\]\((?:[^()\[\]\s]|\([^()\[\]\s]*\)?)*\)?/u', '$1', $text);

        // Bare URLs and dangerous schemes (kept links are placeholders by now).
        $text = (string) preg_replace('~\b(?:https?|ftp)://\S+|\bwww\.[^\s]+|\b(?:javascript|data|vbscript|file):\S*~iu', '', $text);

        $text = strtr($text, $kept);
        $text = (string) preg_replace("/[ \t]+\n/u", "\n", $text);
        $text = (string) preg_replace("/\n{3,}/u", "\n\n", $text);
        $text = (string) preg_replace('/[ \t]{2,}/u', ' ', $text);
        $text = trim($text);
        if (mb_strlen($text) > self::MAX_LENGTH) {
            $text = rtrim(mb_substr($text, 0, self::MAX_LENGTH - 1)).'…';
        }

        return ['text' => $text, 'slugs' => array_values(array_unique($slugs)), 'paths' => array_values(array_unique($paths)), 'handoff' => $handoff];
    }

    /**
     * The lowercase slug of a `/product/<slug>` path (relative, optionally with a query or
     * fragment), else null.
     */
    public static function productSlug(string $url): ?string
    {
        if (preg_match('~^/product/('.self::SLUG.')/?(?:[?#].*)?$~u', $url, $m) === 1) {
            return mb_strtolower($m[1]);
        }

        return null;
    }

    /**
     * @param  array<string, string>  $kept
     */
    private static function keep(array &$kept, string $nonce, string $markdown): string
    {
        // Private-use delimiters (removed from the input) and a per-call nonce: no text can forge one.
        $key = "\u{E000}".$nonce.count($kept)."\u{E001}";
        $kept[$key] = $markdown;

        return $key;
    }
}
