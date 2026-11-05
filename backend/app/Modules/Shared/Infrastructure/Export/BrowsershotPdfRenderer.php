<?php

namespace App\Modules\Shared\Infrastructure\Export;

use App\Modules\Shared\Application\Export\PdfRenderer;
use App\Modules\Shared\Application\Export\PdfUnavailable;
use Illuminate\Support\Facades\Log;
use Spatie\Browsershot\Browsershot;
use Throwable;

/**
 * Renders PDFs with headless Chrome through spatie/browsershot. Browsershot's Node script is
 * started through backend/pdf-renderer/browser.cjs, which hands it puppeteer-core (installed
 * without a Chromium download) and the configured Chrome. JavaScript is disabled: the HTML is
 * a static, fully escaped table with fonts and logo inlined as data URIs.
 */
final class BrowsershotPdfRenderer implements PdfRenderer
{
    public function __construct(private readonly ChromeLocator $chrome) {}

    public function render(string $html, bool $landscape, string $footerHtml): string
    {
        $chrome = $this->chrome->find();
        $script = (string) config('pdf.renderer_script');
        $modules = (string) config('pdf.node_modules_path');
        if ($chrome === null) {
            throw new PdfUnavailable('PDF export is not available: Chrome is not installed on the server. Try Excel instead.');
        }
        if (! is_file($script) || ! is_dir($modules.DIRECTORY_SEPARATOR.'puppeteer-core')) {
            throw new PdfUnavailable('PDF export is not available: the PDF renderer is not installed on the server. Try Excel instead.');
        }

        $directory = storage_path('app/private/pdf-render/'.bin2hex(random_bytes(8)));
        @mkdir($directory, 0700, true);
        $file = $directory.DIRECTORY_SEPARATOR.'document.html';
        file_put_contents($file, $html);

        try {
            // Our own file: the HTML is generated from escaped values only.
            $browsershot = Browsershot::htmlFromFilePath($file)
                ->setChromePath($chrome)
                ->setNodeBinary((string) config('pdf.node_binary'))
                ->setNpmBinary((string) config('pdf.npm_binary'))
                ->setNodeModulePath($modules)
                ->setBinPath($script)
                ->setCustomTempPath($directory)
                ->timeout((int) config('pdf.timeout', 60))
                ->disableJavascript()
                ->format('A4')
                ->landscape($landscape)
                ->margins(12, 10, 14, 10)
                ->showBackground()
                ->showBrowserHeaderAndFooter()
                ->headerHtml('<span></span>')
                ->footerHtml($footerHtml);
            if (config('pdf.no_sandbox')) {
                $browsershot->noSandbox();
            }
            $pdf = $browsershot->pdf();
        } catch (Throwable $e) {
            Log::warning('PDF rendering failed.', ['exception' => $e::class, 'message' => mb_substr($e->getMessage(), 0, 2000)]);

            throw new PdfUnavailable;
        } finally {
            @unlink($file);
            $this->removeDirectory($directory);
        }

        if (! str_starts_with($pdf, '%PDF')) {
            Log::warning('PDF rendering returned no PDF.');

            throw new PdfUnavailable;
        }

        return $pdf;
    }

    private function removeDirectory(string $directory): void
    {
        if (! is_dir($directory)) {
            return;
        }
        foreach (glob($directory.DIRECTORY_SEPARATOR.'*') ?: [] as $path) {
            is_dir($path) ? $this->removeDirectory($path) : @unlink($path);
        }
        @rmdir($directory);
    }
}
