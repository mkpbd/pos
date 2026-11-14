<?php

namespace App\Modules\Social\Tests\Unit;

use App\Modules\Social\Application\Actions\SuggestCaptions;
use App\Modules\Social\Domain\Caption;
use App\Modules\Social\Domain\CaptionTemplates;
use App\Modules\Social\Domain\Meta\MetaApp;
use App\Modules\Social\Domain\Meta\MetaGraphError;
use App\Modules\Social\Domain\PostStatus;
use App\Modules\Social\Domain\PostTarget;
use App\Modules\Social\Domain\PublicUrl;
use App\Modules\Social\Domain\TargetStatus;
use PHPUnit\Framework\TestCase;

/**
 * P2b: the Social module's pure rules.
 */
class SocialDomainTest extends TestCase
{
    public function test_captions_count_hashtags_and_append_links(): void
    {
        $this->assertSame(3, Caption::hashtagCount('New in! #polo #সামার #summer_2026 and a#b, &#123; #'));
        $this->assertSame("Hello\n\nhttps://shop.example/go/abc123", Caption::withLink("Hello  \n", 'https://shop.example/go/abc123', PostTarget::Facebook));
        $this->assertSame('Hello', Caption::withLink('Hello', null, PostTarget::Instagram));
        $long = str_repeat('a', 2190);
        $this->assertSame($long, Caption::withLink($long, 'https://shop.example/go/abc123', PostTarget::Instagram), 'Instagram drops a link that does not fit.');
        $this->assertSame($long."\n\nhttps://shop.example/go/abc123", Caption::withLink($long, 'https://shop.example/go/abc123', PostTarget::Facebook));
    }

    public function test_public_https_addresses(): void
    {
        foreach (['https://shop.example.com/storage/a.jpg', 'https://cdn.berrykids.com.bd/x.jpg', 'https://93.184.216.34/a.jpg'] as $url) {
            $this->assertTrue(PublicUrl::isPublicHttps($url), $url);
        }
        foreach ([null, '', '/storage/a.jpg', 'http://shop.example.com/a.jpg', 'https://localhost/a.jpg', 'https://kids.shop.localhost/a.jpg', 'https://berry.test/a.jpg',
            'https://shop.local/a.jpg', 'https://intranet/a.jpg', 'https://192.168.1.10/a.jpg', 'https://127.0.0.1/a.jpg', 'https://[::1]/a.jpg', 'https://10.0.0.5/a.jpg'] as $url) {
            $this->assertFalse(PublicUrl::isPublicHttps($url), (string) $url);
        }
    }

    public function test_post_status_rules(): void
    {
        $this->assertSame(['edit', 'publish', 'delete'], PostStatus::Draft->allowedActions());
        $this->assertSame(['edit', 'publish', 'cancel', 'delete'], PostStatus::Scheduled->allowedActions());
        $this->assertSame([], PostStatus::Publishing->allowedActions());
        $this->assertSame([], PostStatus::Published->allowedActions());
        $this->assertSame(['retry'], PostStatus::PartiallyPublished->allowedActions());
        $this->assertSame(['edit', 'retry', 'delete'], PostStatus::Failed->allowedActions());

        $this->assertSame(PostStatus::Publishing, PostStatus::fromTargets([TargetStatus::Published, TargetStatus::Pending]));
        $this->assertSame(PostStatus::Publishing, PostStatus::fromTargets([TargetStatus::Publishing]));
        $this->assertSame(PostStatus::Published, PostStatus::fromTargets([TargetStatus::Published, TargetStatus::Published]));
        $this->assertSame(PostStatus::PartiallyPublished, PostStatus::fromTargets([TargetStatus::Published, TargetStatus::Failed]));
        $this->assertSame(PostStatus::Failed, PostStatus::fromTargets([TargetStatus::Failed, TargetStatus::Failed]));
        $this->assertSame(PostStatus::Failed, PostStatus::fromTargets([]));
    }

    public function test_template_captions(): void
    {
        $this->assertSame('৳450', CaptionTemplates::money('450.00'));
        $this->assertSame('৳1,250.50', CaptionTemplates::money('1250.5'));
        $this->assertSame('৳1,000,000', CaptionTemplates::money('1000000.00'));
        $this->assertSame(['#ClassicShop', '#শার্ট', '#PoloCo'], CaptionTemplates::hashtags(['Classic Shop', 'শার্ট', null, 'Polo & Co.', 'classic shop', '2026']));

        foreach (CaptionTemplates::LANGUAGES as $language) {
            foreach (CaptionTemplates::TONES as $tone) {
                $captions = CaptionTemplates::captions(['name' => 'Polo Shirt', 'price' => '500.00', 'sale_price' => '450.00', 'offer' => 'Eid deal', 'store' => 'Classic Shop', 'brand' => 'Polo', 'category' => 'Shirts'], $language, $tone);
                $this->assertCount(3, $captions);
                $this->assertCount(3, array_unique($captions));
                foreach ($captions as $caption) {
                    $this->assertStringContainsString('Polo Shirt', $caption);
                    $this->assertStringContainsString('৳450', $caption);
                    $this->assertStringNotContainsString('{', $caption);
                    $this->assertLessThanOrEqual(Caption::MAX, mb_strlen($caption));
                }
            }
        }
        $this->assertSame("Polo Shirt is here! ✨\nPrice: ৳500\nTap the link to order 👇\n\n#ClassicShop", CaptionTemplates::captions(['name' => 'Polo Shirt', 'price' => '500.00', 'store' => 'Classic Shop'], 'en', 'friendly')[0]);
        $this->assertStringContainsString('Eid deal: এখন মাত্র ৳450 (আগে ৳500)', CaptionTemplates::captions(['name' => 'Polo Shirt', 'price' => '500.00', 'sale_price' => '450.00', 'offer' => 'Eid deal', 'store' => 'Classic Shop'], 'bn', 'friendly')[0]);
    }

    public function test_graph_errors_become_plain_messages_without_tokens(): void
    {
        $expired = MetaGraphError::fromGraph(['message' => 'Error validating access token', 'type' => 'OAuthException', 'code' => 190, 'error_subcode' => 463, 'fbtrace_id' => 'A1'], 400);
        $this->assertSame(['TOKEN_EXPIRED', 190, 463, 400, 'A1'], [$expired->errorCode, $expired->graphCode, $expired->graphSubcode, $expired->httpStatus, $expired->traceId]);
        $this->assertStringContainsString('Reconnect Facebook', $expired->getMessage());
        $this->assertSame('PERMISSION_MISSING', MetaGraphError::fromGraph(['code' => 200], 403)->errorCode);
        $this->assertSame('PERMISSION_MISSING', MetaGraphError::fromGraph(['code' => 10], 403)->errorCode);
        $this->assertSame('RATE_LIMITED', MetaGraphError::fromGraph(['code' => 32], 400)->errorCode);
        $this->assertSame('RATE_LIMITED', MetaGraphError::fromGraph(['code' => 80001], 400)->errorCode);
        $this->assertSame('SPAM_BLOCKED', MetaGraphError::fromGraph(['code' => 368], 400)->errorCode);
        $this->assertSame('MEDIA_REJECTED', MetaGraphError::fromGraph(['code' => 9004, 'error_subcode' => 2207052], 400)->errorCode);
        $this->assertSame('MEDIA_REJECTED', MetaGraphError::fromGraph(['code' => 36003], 400)->errorCode);
        $this->assertSame('GRAPH_ERROR', MetaGraphError::fromGraph(['code' => 2], 503)->errorCode);
        $other = MetaGraphError::fromGraph(['code' => 100, 'message' => 'Invalid parameter access_token=EAAsecretToken12345 client_secret=abc'], 400);
        $this->assertSame('GRAPH_ERROR', $other->errorCode);
        $this->assertStringNotContainsString('EAAsecretToken12345', $other->getMessage());
        $this->assertStringNotContainsString('client_secret=abc', $other->getMessage());
        $this->assertStringContainsString('Facebook rejected the request: Invalid parameter', $other->getMessage());
        $this->assertSame('[token] here', MetaGraphError::scrub('EAAAbcdefghijklmnop here'));

        // The app secret never shows in a dump.
        $this->assertStringNotContainsString('s3cr3t-value', print_r(new MetaApp('123', 's3cr3t-value'), true));
    }

    public function test_ai_caption_answers_are_parsed_strictly(): void
    {
        $this->assertSame(['a', 'b', 'c'], SuggestCaptions::parse('{"captions": ["a", "b", "c", "d"]}'));
        $this->assertSame(['a', 'b', 'c'], SuggestCaptions::parse("Sure!\n```json\n{\"captions\": [\" a \", \"b\", \"c\"]}\n```"));
        $this->assertNull(SuggestCaptions::parse('{"captions": ["a", "b"]}'));
        $this->assertNull(SuggestCaptions::parse('{"captions": ["a", "", "c"]}'));
        $this->assertNull(SuggestCaptions::parse('no json'));
        $this->assertNull(SuggestCaptions::parse('{"captions": "a"}'));
        $this->assertNull(SuggestCaptions::parse('{"captions": ["a", "b", "'.str_repeat('x', 2201).'"]}'));
    }
}
