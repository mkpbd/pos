<?php

namespace App\Modules\Shared\Infrastructure\Export;

/**
 * Finds the Chrome / Chromium executable for PDF rendering: `pdf.chrome_path` when set,
 * otherwise the newest Playwright Chromium under %LOCALAPPDATA%\ms-playwright (local
 * development), otherwise a system Chromium. Null when none exists.
 */
final class ChromeLocator
{
    private const SYSTEM_PATHS = [
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
        '/usr/bin/google-chrome',
        '/usr/bin/google-chrome-stable',
        '/snap/bin/chromium',
    ];

    public function __construct(
        private readonly ?string $configured,
        private readonly ?string $localAppData,
    ) {}

    public static function fromConfig(): self
    {
        $configured = config('pdf.chrome_path');
        $localAppData = getenv('LOCALAPPDATA');

        return new self(
            is_string($configured) && trim($configured) !== '' ? trim($configured) : null,
            is_string($localAppData) && $localAppData !== '' ? $localAppData : null,
        );
    }

    public function find(): ?string
    {
        if ($this->configured !== null) {
            return is_file($this->configured) ? $this->configured : null;
        }

        return $this->playwrightChromium() ?? $this->systemChromium();
    }

    private function playwrightChromium(): ?string
    {
        if ($this->localAppData === null) {
            return null;
        }
        $root = rtrim($this->localAppData, '\\/').DIRECTORY_SEPARATOR.'ms-playwright';
        $candidates = [];
        foreach (glob($root.DIRECTORY_SEPARATOR.'chromium-*', GLOB_ONLYDIR) ?: [] as $dir) {
            if (preg_match('/chromium-(\d+)$/', $dir, $m) !== 1) {
                continue;
            }
            foreach (['chrome-win64', 'chrome-win'] as $folder) {
                $exe = $dir.DIRECTORY_SEPARATOR.$folder.DIRECTORY_SEPARATOR.'chrome.exe';
                if (is_file($exe)) {
                    $candidates[(int) $m[1]] = $exe;
                    break;
                }
            }
        }
        if ($candidates === []) {
            return null;
        }
        krsort($candidates);

        return reset($candidates);
    }

    private function systemChromium(): ?string
    {
        foreach (self::SYSTEM_PATHS as $path) {
            if (is_file($path)) {
                return $path;
            }
        }

        return null;
    }
}
