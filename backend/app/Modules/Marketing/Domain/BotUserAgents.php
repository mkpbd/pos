<?php

namespace App\Modules\Marketing\Domain;

/**
 * P2a: crawlers and link previewers (Facebook's and messengers' link previews fetch every
 * shared link) are not visitors: their visits and short link clicks are not counted. A missing
 * user agent counts as a bot.
 */
final class BotUserAgents
{
    /** Lower-case fragments of known bot user agents. */
    public const FRAGMENTS = [
        'bot', 'crawl', 'spider', 'slurp', 'facebookexternalhit', 'facebookcatalog', 'meta-externalagent', 'whatsapp',
        'telegram', 'viber', 'skypeuripreview', 'discord', 'embedly', 'quora link preview', 'pinterest', 'linkedinbot',
        'preview', 'headless', 'lighthouse', 'pagespeed', 'curl/', 'wget/', 'python-requests', 'python-urllib', 'go-http-client',
        'okhttp', 'axios/', 'node-fetch', 'java/', 'libwww', 'httpclient', 'scrapy', 'phantomjs', 'puppeteer', 'playwright',
    ];

    public static function isBot(?string $userAgent): bool
    {
        if ($userAgent === null || trim($userAgent) === '') {
            return true;
        }
        $agent = mb_strtolower($userAgent);
        foreach (self::FRAGMENTS as $fragment) {
            if (str_contains($agent, $fragment)) {
                return true;
            }
        }

        return false;
    }
}
