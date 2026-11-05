<?php

namespace App\Modules\Shared\Application\Export;

/**
 * Turns a complete HTML document into PDF bytes (A4). Implementations throw PdfUnavailable
 * when no renderer can run (Chrome missing, Node failing, timeout) — never a raw error.
 */
interface PdfRenderer
{
    /**
     * @param  string  $footerHtml  Chrome footer template (may use `pageNumber` / `totalPages` spans)
     */
    public function render(string $html, bool $landscape, string $footerHtml): string;
}
