<?php

namespace App\Modules\AI\Tests\Unit;

use App\Modules\AI\Domain\Shopper\ShopperFallbacks;
use App\Modules\AI\Domain\Shopper\ShopperReplyText;
use PHPUnit\Framework\TestCase;

/**
 * AI2b output safety: only links to products / own pages the tools returned survive; every other
 * URL is removed (labels kept); HTML is stripped; the hand-off marker is taken out.
 */
class ShopperReplyTextTest extends TestCase
{
    public function test_keeps_only_known_product_and_page_links(): void
    {
        $text = "**Tee** [Kids Tee](/product/Kids-Tee) and [Shoe](/product/shoe)\n- [Returns](/pages/returns)\n- [FAQ](/pages/faq)\n- [Shop](https://evil.test/p?x=1) [Home](//evil.test) [x](javascript:alert(1))";

        $clean = ShopperReplyText::clean($text, ['kids-tee'], ['/pages/returns']);

        $this->assertSame("**Tee** [Kids Tee](/product/kids-tee) and Shoe\n- [Returns](/pages/returns)\n- FAQ\n- Shop Home x", $clean['text']);
        $this->assertSame(['kids-tee'], $clean['slugs']);
        $this->assertSame(['/pages/returns'], $clean['paths']);
        $this->assertFalse($clean['handoff']);
    }

    public function test_removes_bare_urls_html_images_and_schemes(): void
    {
        $clean = ShopperReplyText::clean("Visit https://evil.test/a or www.evil.test today. <img src=x onerror=alert(1)><a href=\"https://x.test\">click</a> ![logo](https://img.test/l.png) javascript:alert(1) data:text/html,hi Under < 500 taka.\n\n\n\n[[HANDOFF]]", [], []);

        $this->assertSame('Visit or today. click logo Under < 500 taka.', $clean['text']);
        $this->assertTrue($clean['handoff']);
    }

    public function test_linked_slugs_and_placeholder_spoofing(): void
    {
        $this->assertSame(['tee', 'shoe'], ShopperReplyText::linkedSlugs('[a](/product/tee) [b](/product/Shoe?x=1) [c](/product/tee) ![d](/product/img) [e](/pages/x)'));
        // Placeholder delimiters in the input are dropped (the text between stays plain text) and
        // cannot bring back a removed link.
        $this->assertSame('a0b', ShopperReplyText::clean("a\u{E000}0\u{E001}b", [], [])['text']);
        $spoof = ShopperReplyText::clean("[ok](/pages/returns) \u{E000}0\u{E001} [bad](https://evil.test)", [], ['/pages/returns']);
        $this->assertSame('[ok](/pages/returns) 0 bad', $spoof['text']);
        // Malformed and unterminated links keep only their label.
        $this->assertSame('a b c', ShopperReplyText::clean('[a](https://x.test/(y)) [b](javascript:void(0) [c](/pages/x', [], [])['text']);
        $this->assertSame('see more b)', ShopperReplyText::clean('see [more](https://evil.test/a b)', [], [])['text']);
        $this->assertSame(ShopperReplyText::MAX_LENGTH, mb_strlen(ShopperReplyText::clean(str_repeat('ক', 3000), [], [])['text']));
    }

    public function test_fallback_texts_in_both_languages(): void
    {
        $this->assertSame('Sorry, I can\'t answer right now. You can contact us through our contact page.', ShopperFallbacks::text(ShopperFallbacks::UNAVAILABLE, 'en', 'contact'));
        $this->assertSame('এই চ্যাটের সীমা পূর্ণ হয়েছে। আরও জানতে নতুন চ্যাট শুরু করুন।', ShopperFallbacks::text(ShopperFallbacks::CONVERSATION_FULL, 'bn'));
        $this->assertSame(ShopperFallbacks::text(ShopperFallbacks::BUSY, 'en'), ShopperFallbacks::text(ShopperFallbacks::BUSY, 'fr'));
    }
}
