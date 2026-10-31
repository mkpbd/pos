<?php

namespace App\Modules\Storefront\Tests\Unit;

use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Storefront\Domain\CustomCssPolicy;
use App\Modules\Storefront\Domain\LinkTarget;
use App\Modules\Storefront\Domain\ThemeSchema;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

class StorefrontRulesTest extends TestCase
{
    /**
     * @return array<string, array{string, bool}>
     */
    public static function links(): array
    {
        return [
            'site path' => ['/boys/shirts?size=2', true],
            'https' => ['https://blog.example.com/a', true],
            'http' => ['http://example.com', true],
            'protocol relative' => ['//evil.test', false],
            'javascript' => ['javascript:alert(1)', false],
            'javascript mixed case' => ['JaVaScRiPt:alert(1)', false],
            'data' => ['data:text/html,x', false],
            'mailto' => ['mailto:a@b.c', false],
            'backslash trick' => ['/\\evil.test', false],
            'whitespace' => ['/a b', false],
            'relative without slash' => ['boys', false],
            'empty' => ['', false],
        ];
    }

    #[DataProvider('links')]
    public function test_link_targets(string $link, bool $safe): void
    {
        $this->assertSame($safe, LinkTarget::isSafe($link));
    }

    public function test_custom_css_policy_allows_media_urls_only(): void
    {
        CustomCssPolicy::assertAllowed('.hero{background:url(/storage/media/a.png)} .b{background:url("/storage/b.webp")}');

        foreach (['.a{background:URL(https://x.test/a.png)}', '.a{background:url( //x.test/a.png )}', ".a{background:url('data:image/png;base64,AA')}", str_repeat('a', CustomCssPolicy::MAX_BYTES + 1)] as $css) {
            try {
                CustomCssPolicy::assertAllowed($css);
                $this->fail("Accepted: {$css}");
            } catch (BusinessRuleViolation $e) {
                $this->assertSame('CUSTOM_CSS_REJECTED', $e->errorCode);
            }
        }
    }

    public function test_theme_normalization_keeps_known_keys_and_fills_defaults(): void
    {
        $theme = ThemeSchema::normalize([
            'colors' => ['primary' => '#000000', 'bogus' => '#111111'],
            'footer' => ['social' => ['facebook' => 'https://f.test'], 'payment_logo_media_ids' => ['a', 'b']],
            'extra' => true,
        ]);

        $this->assertSame('#000000', $theme['colors']['primary']);
        $this->assertSame(ThemeSchema::defaults()['colors']['accent'], $theme['colors']['accent']);
        $this->assertArrayNotHasKey('bogus', $theme['colors']);
        $this->assertArrayNotHasKey('extra', $theme);
        $this->assertSame('https://f.test', $theme['footer']['social']['facebook']);
        $this->assertNull($theme['footer']['social']['instagram']);
        $this->assertSame(['a', 'b'], $theme['footer']['payment_logo_media_ids']);
        $this->assertSame(['a', 'b'], ThemeSchema::mediaIds($theme));
    }
}
