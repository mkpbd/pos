<?php

namespace App\Modules\Shared\Domain;

/**
 * Supported video links (B4, shared since P1b): YouTube `youtube.com/watch?v=`, `youtu.be/`,
 * `youtube.com/shorts/` (id 6–20 of `[A-Za-z0-9_-]`) or Vimeo `vimeo.com/<digits>`. The store
 * builder's video element and background video and the product listing's video use the same
 * rule, so a link accepted in one place is accepted everywhere. Embeds are built by the
 * storefront from the provider and id (privacy-enhanced players), never from the link itself.
 */
final class VideoUrl
{
    public const PROVIDERS = ['youtube', 'vimeo'];

    public const MAX_LENGTH = 500;

    /** The message shown for a link that is not a supported video. */
    public const INVALID_MESSAGE = 'Paste a YouTube link (youtube.com/watch?v=…, youtu.be/…, youtube.com/shorts/…) or a Vimeo link (vimeo.com/…).';

    /**
     * `{provider, video_id}` of a supported video URL, or null.
     *
     * @return array{provider: string, video_id: string}|null
     */
    public static function parse(mixed $url): ?array
    {
        if (! is_string($url) || mb_strlen($url) > self::MAX_LENGTH) {
            return null;
        }
        $patterns = [
            'youtube' => [
                '#^https?://(?:www\.|m\.)?youtube\.com/watch\?(?:[^\s\#]*&)?v=([A-Za-z0-9_-]{6,20})(?:[&\#][^\s]*)?$#',
                '#^https?://youtu\.be/([A-Za-z0-9_-]{6,20})(?:[?\#][^\s]*)?$#',
                '#^https?://(?:www\.|m\.)?youtube\.com/shorts/([A-Za-z0-9_-]{6,20})(?:[?\#][^\s]*)?$#',
            ],
            'vimeo' => ['#^https?://(?:www\.)?vimeo\.com/(\d{1,20})(?:[/?\#][^\s]*)?$#'],
        ];
        foreach ($patterns as $provider => $list) {
            foreach ($list as $pattern) {
                if (preg_match($pattern, $url, $m) === 1) {
                    return ['provider' => $provider, 'video_id' => $m[1]];
                }
            }
        }

        return null;
    }
}
