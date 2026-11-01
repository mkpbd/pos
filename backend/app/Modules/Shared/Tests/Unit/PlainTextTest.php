<?php

namespace App\Modules\Shared\Tests\Unit;

use App\Modules\Shared\Domain\PlainText;
use PHPUnit\Framework\TestCase;

class PlainTextTest extends TestCase
{
    public function test_html_becomes_collapsed_plain_text(): void
    {
        $this->assertSame('Soft & warm. Line two', PlainText::fromHtml("<p>Soft &amp; <strong>warm</strong>.</p>\n<p>Line<br>two</p>"));
        $this->assertNull(PlainText::fromHtml('<p> </p>'));
        $this->assertNull(PlainText::fromHtml(null));
    }

    public function test_excerpts_cut_at_a_word_boundary(): void
    {
        $this->assertSame('Short text', PlainText::excerpt('<p>Short text</p>', 160));
        $excerpt = PlainText::excerpt(str_repeat('word ', 100), 30);
        $this->assertSame('word word word word word…', $excerpt);
        $this->assertLessThanOrEqual(30, mb_strlen((string) $excerpt));
    }
}
