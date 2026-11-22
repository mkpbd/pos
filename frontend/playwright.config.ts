import { defineConfig, devices } from '@playwright/test'

// E2E_PORT runs the suite on its own dev server when 5173 is taken by another one.
const port = Number(process.env.E2E_PORT ?? 5173)
const baseURL = `http://localhost:${port}`
// The storefront hosts the full-stack specs sign in on (store builder demos and the default store).
const DEMO_HOSTS = ['shop.localhost', ...['beauty', 'classic', 'electronics', 'fashion', 'furniture', 'grocery', 'handmade', 'kids', 'vegan'].map((name) => `${name}.shop.localhost`)]

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL,
    trace: 'on-first-retry',
    // B21: the store builder opens in Easy mode with a guided tour the first time someone uses it.
    // Specs written before that expect the full editor with nothing over it, so every context starts
    // as a returning builder user (a `pos.builder.*` key from before: the B12 recent commands, empty).
    // store-builder-b21-easy.spec.ts starts from empty storage for the first visit.
    // Seeded for every origin the specs open: the app itself and each demo store's own host (full-stack demo tests).
    storageState: {
      cookies: [],
      origins: [baseURL, `http://127.0.0.1:${port}`, ...DEMO_HOSTS.map((host) => `http://${host}:${port}`)].map((origin) => ({
        origin,
        localStorage: [{ name: 'pos.builder.commands.recent', value: '[]' }],
      })),
    },
  },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: `npm run dev -- --strictPort --port ${port}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
  },
})
