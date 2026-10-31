import { defineConfig, devices } from '@playwright/test'

// E2E_PORT runs the suite on its own dev server when 5173 is taken by another one.
const port = Number(process.env.E2E_PORT ?? 5173)
const baseURL = `http://localhost:${port}`

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL,
    trace: 'on-first-retry',
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
