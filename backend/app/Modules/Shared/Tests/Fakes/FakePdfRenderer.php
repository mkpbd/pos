<?php

namespace App\Modules\Shared\Tests\Fakes;

use App\Modules\Shared\Application\Export\PdfRenderer;

/**
 * Records the HTML handed to the renderer instead of starting Chrome.
 */
final class FakePdfRenderer implements PdfRenderer
{
    /** @var list<array{html: string, landscape: bool, footer: string}> */
    public array $rendered = [];

    public function render(string $html, bool $landscape, string $footerHtml): string
    {
        $this->rendered[] = ['html' => $html, 'landscape' => $landscape, 'footer' => $footerHtml];

        return "%PDF-1.7\n% fake export\n%%EOF\n";
    }

    public function lastHtml(): string
    {
        return $this->rendered[array_key_last($this->rendered)]['html'] ?? '';
    }
}
