<?php

namespace App\Modules\Shared\Tests\Unit;

use App\Modules\Shared\Application\Contracts\HtmlSanitizer;
use App\Modules\Shared\Infrastructure\Html\PurifierHtmlSanitizer;
use Tests\TestCase;

class HtmlSanitizerTest extends TestCase
{
    private function clean(string $html): string
    {
        return $this->app->make(HtmlSanitizer::class)->clean($html);
    }

    public function test_formatting_survives_and_active_content_does_not(): void
    {
        $this->assertSame(
            '<h2>Title</h2><p><strong>Bold</strong> <em>it</em> <u>u</u> <s>s</s></p><ul><li>One</li></ul><blockquote>Q</blockquote><hr /><table><tr><td>1</td></tr></table>',
            $this->clean('<h2>Title</h2><p><strong>Bold</strong> <em>it</em> <u>u</u> <s>s</s></p><ul><li>One</li></ul><blockquote>Q</blockquote><hr><table><tr><td>1</td></tr></table>'),
        );
        $this->assertSame('<p>Hi</p>', $this->clean('<p onclick="x()" style="color:red">Hi<script>alert(1)</script></p><iframe src="https://evil.test"></iframe><style>p{}</style>'));
        // h1 is reserved for the page title; its text stays.
        $this->assertSame('Title', $this->clean('<h1>Title</h1>'));
    }

    public function test_links_are_limited_to_safe_schemes_and_new_tabs_get_noopener(): void
    {
        $this->assertSame('<a>x</a>', $this->clean('<a href="javascript:alert(1)">x</a>'));
        $this->assertSame('<a>x</a>', $this->clean('<a href="data:text/html,hi">x</a>'));
        $this->assertSame('<a href="/pages/about">x</a>', $this->clean('<a href="/pages/about">x</a>'));
        $this->assertSame('<a href="mailto:hi@shop.test">x</a>', $this->clean('<a href="mailto:hi@shop.test">x</a>'));
        $this->assertSame('<a href="https://shop.test" target="_blank" rel="noreferrer noopener">x</a>', $this->clean('<a href="https://shop.test" target="_blank">x</a>'));
        $this->assertSame('<a href="https://shop.test">x</a>', $this->clean('<a href="https://shop.test" target="_top">x</a>'));
    }

    public function test_images_only_from_own_media_storage(): void
    {
        $this->assertSame('<img src="/storage/media/a.webp" alt="A" />', $this->clean('<img src="/storage/media/a.webp" alt="A" onerror="x()">'));
        $this->assertSame('', $this->clean('<img src="https://tracker.test/p.gif" alt="">'));
        $this->assertSame('', $this->clean('<img src="//tracker.test/p.gif" alt="">'));
        $this->assertSame('', $this->clean('<img src="/storage/../../.env" alt="">'));
        $this->assertSame('<figure><img src="/storage/x.png" alt="x" /><figcaption>Caption</figcaption></figure>', $this->clean('<figure><img src="/storage/x.png" alt="x"><figcaption>Caption</figcaption></figure>'));

        $cdn = new PurifierHtmlSanitizer(['https://cdn.shop.test/']);
        $this->assertSame('<img src="https://cdn.shop.test/m/a.webp" alt="" />', $cdn->clean('<img src="https://cdn.shop.test/m/a.webp" alt="">'));
        $this->assertSame('', $cdn->clean('<img src="https://cdn.shop.test.evil.test/a.webp" alt="">'));
    }
}
