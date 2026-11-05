// Entry point for spatie/browsershot (config pdf.renderer_script): runs Browsershot's own
// script with puppeteer-core from this folder, so no full `puppeteer` (and no bundled
// Chromium download) is needed. Chrome comes from the executablePath Browsershot passes.
const path = require('path');

const browsershot = require(path.resolve(__dirname, '../vendor/spatie/browsershot/bin/browser.cjs'));

browsershot.callChrome(require('puppeteer-core'));
