<?php

namespace App\Modules\Shared\Tests\Unit;

use App\Modules\Marketing\Domain\BotUserAgents;
use App\Modules\Marketing\Domain\ShortLinkTarget;
use App\Modules\Shared\Domain\CampaignAttribution;
use PHPUnit\Framework\TestCase;

/**
 * P2a: campaign attribution is sanitized, never rejected; short link targets are store paths;
 * bots are recognised by their user agent.
 */
class CampaignAttributionTest extends TestCase
{
    public function test_attribution_keeps_known_keys_with_clean_values(): void
    {
        $this->assertSame([
            'utm_source' => 'facebook',
            'utm_medium' => 'cpc',
            'utm_campaign' => 'eid sale',
            'utm_content' => 'Video A',
            'short_link' => 'eid-fb',
            'landing_path' => '/p/eid',
            'referrer_host' => 'm.facebook.com',
            'first_seen_at' => '2026-11-14T10:00:00+06:00',
        ], CampaignAttribution::sanitize([
            'utm_source' => ' FaceBook ',
            'utm_medium' => "CPC\u{0000}",
            'utm_campaign' => 'Eid Sale',
            'utm_content' => 'Video A',
            'utm_term' => '   ',
            'short_link' => 'EID-FB',
            'landing_path' => '/p/eid?fbclid=123#top',
            'referrer_host' => 'https://m.facebook.com/story',
            'first_seen_at' => '2026-11-14T10:00:00+06:00',
            'email' => 'someone@example.com',
        ]));
        $this->assertSame(100, mb_strlen(CampaignAttribution::sanitize(['utm_source' => str_repeat('a', 300)])['utm_source']));
        $this->assertNull(CampaignAttribution::sanitize(['short_link' => 'no spaces', 'landing_path' => '//evil.test', 'referrer_host' => 'bad host', 'first_seen_at' => 'yesterday']));
        $this->assertNull(CampaignAttribution::sanitize('utm_source=x'));
        $this->assertNull(CampaignAttribution::sanitize([]));
        $this->assertNull(CampaignAttribution::path('https://evil.test/x'));
        $this->assertNull(CampaignAttribution::path('/a\\b'));
    }

    public function test_short_link_targets_and_redirects(): void
    {
        foreach (['/', '/p/eid-sale', '/product/tea?size=large', '/shop#top'] as $ok) {
            $this->assertTrue(ShortLinkTarget::isValid($ok), $ok);
        }
        foreach (['', 'p/eid', '//evil.test', 'https://evil.test', '/a b', '/go/x', '/go', '/x\\y', str_repeat('/a', 200)] as $bad) {
            $this->assertFalse(ShortLinkTarget::isValid($bad), $bad);
        }
        $this->assertSame(
            '/p/eid?size=l&utm_source=facebook&utm_campaign=eid%20sale&sl=eid-fb#order',
            ShortLinkTarget::redirect('/p/eid?size=l&utm_source=old#order', ['source' => 'facebook', 'medium' => null, 'campaign' => 'eid sale', 'content' => '', 'term' => null], 'eid-fb'),
        );
    }

    public function test_bots_are_recognised(): void
    {
        foreach (['facebookexternalhit/1.1', 'Mozilla/5.0 (compatible; Googlebot/2.1)', 'WhatsApp/2.23', 'curl/8.4', 'Mozilla/5.0 HeadlessChrome/120', null, ''] as $bot) {
            $this->assertTrue(BotUserAgents::isBot($bot), (string) $bot);
        }
        $this->assertFalse(BotUserAgents::isBot('Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/131 Mobile Safari/537.36'));
        $this->assertFalse(BotUserAgents::isBot('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) AppleWebKit/605.1.15 [FBAN/FBIOS;FBAV/440.0]'));
    }
}
