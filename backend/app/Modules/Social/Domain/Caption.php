<?php

namespace App\Modules\Social\Domain;

/**
 * P2b: caption rules shared by Facebook and Instagram — at most 2200 characters (Instagram's
 * limit, used for both), at most 30 hashtags on Instagram, and the post's link added at the end
 * when it is published (on Instagram only when it still fits).
 */
final class Caption
{
    public const MAX = 2200;

    public const MAX_HASHTAGS = 30;

    /**
     * Hashtags in the text (`#word`, letters of any script, digits and "_"; not "&#…;" or "a#b").
     */
    public static function hashtagCount(string $caption): int
    {
        return (int) preg_match_all('/(?<![\p{L}\p{N}_&#])#[\p{L}\p{M}\p{N}_]+/u', $caption);
    }

    /**
     * The text a network receives: the caption with the link on its own line after a blank line.
     * Instagram drops the link rather than going over the limit (links are not clickable there).
     */
    public static function withLink(string $caption, ?string $url, PostTarget $target): string
    {
        $caption = rtrim($caption);
        if ($url === null || $url === '') {
            return $caption;
        }
        $joined = $caption."\n\n".$url;

        return $target === PostTarget::Instagram && mb_strlen($joined) > self::MAX ? $caption : $joined;
    }
}
