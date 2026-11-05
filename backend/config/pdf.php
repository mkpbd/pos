<?php

return [

    /*
    | PDF rendering (X1) with headless Chrome through spatie/browsershot and puppeteer-core.
    |
    | chrome_path: the Chrome / Chromium executable. Empty = auto-detect: the newest Playwright
    |   Chromium under %LOCALAPPDATA%\ms-playwright (local Windows development), then the usual
    |   system locations (/usr/bin/chromium, /usr/bin/chromium-browser, /usr/bin/google-chrome,
    |   /usr/bin/google-chrome-stable). In production install a system Chromium and set
    |   PDF_CHROME_PATH. No Chrome found → 503 PDF_UNAVAILABLE (exports to Excel keep working).
    | node_binary / npm_binary: Node.js (>= 22.12) used to drive Chrome.
    | node_modules_path: where `npm ci` in backend/pdf-renderer installed puppeteer-core
    |   (PUPPETEER_SKIP_DOWNLOAD=1 — Chrome is never downloaded).
    | renderer_script: the small wrapper that hands puppeteer-core to Browsershot's script.
    */
    'chrome_path' => env('PDF_CHROME_PATH'),
    'node_binary' => env('PDF_NODE_BINARY', 'node'),
    'npm_binary' => env('PDF_NPM_BINARY', 'npm'),
    'node_modules_path' => env('PDF_NODE_MODULES_PATH', base_path('pdf-renderer/node_modules')),
    'renderer_script' => env('PDF_RENDERER_SCRIPT', base_path('pdf-renderer/browser.cjs')),

    // Seconds before a render is abandoned (503 PDF_UNAVAILABLE).
    'timeout' => (int) env('PDF_TIMEOUT', 60),

    // Chrome's sandbox needs user namespaces; containers running as root usually need this on.
    'no_sandbox' => (bool) env('PDF_NO_SANDBOX', false),

];
