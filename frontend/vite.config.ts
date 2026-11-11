/// <reference types="vitest/config" />
import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type Plugin } from 'vite'

/** The store builder canvas page (third entry); production Nginx maps it to dist/builder-canvas.html. */
const BUILDER_CANVAS_PATH = '/admin/builder-canvas'

/** Paths served by Laravel (proxied in development), never by either SPA. */
const BACKEND_PATHS = ['/api', '/sanctum', '/storage']

/**
 * Two apps (plus the builder canvas), one dev server — mirrors the production routing (ADR-007):
 * /admin/* is the back-office SPA (index.html), every other page is the storefront
 * (storefront.html). Only HTML navigations are rewritten; modules and assets pass through.
 */
function appEntries(): Plugin {
  return {
    name: 'pos-app-entries',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const path = (req.url ?? '/').split('?')[0]
        const wantsHtml = req.method === 'GET' && (req.headers.accept ?? '').includes('text/html')
        if (wantsHtml && !BACKEND_PATHS.some((p) => path === p || path.startsWith(`${p}/`))) {
          // The store builder's canvas (B2): the storefront renderer alone, in the editor's iframe.
          req.url = path === BUILDER_CANVAS_PATH ? '/builder-canvas.html' : path === '/admin' || path.startsWith('/admin/') ? '/index.html' : '/storefront.html'
        }
        next()
      })
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  // A shell variable wins over .env.local, so e2e runs can point at a scratch backend.
  const backend = process.env.VITE_BACKEND_ORIGIN ?? env.VITE_BACKEND_ORIGIN ?? 'http://127.0.0.1:8000'

  return {
    plugins: [react(), tailwindcss(), appEntries()],
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    build: {
      rollupOptions: {
        input: {
          admin: fileURLToPath(new URL('./index.html', import.meta.url)),
          storefront: fileURLToPath(new URL('./storefront.html', import.meta.url)),
          builderCanvas: fileURLToPath(new URL('./builder-canvas.html', import.meta.url)),
        },
      },
    },
    server: {
      port: 5173,
      // Same-origin proxy so Sanctum SPA cookie auth works in development. `xfwd` passes the
      // browser's host (X-Forwarded-Host) so a backend with TRUSTED_PROXIES=127.0.0.1 resolves
      // the storefront by it — e.g. the demo stores at vegan.shop.localhost:5173.
      proxy: Object.fromEntries(BACKEND_PATHS.map((p) => [p, { target: backend, changeOrigin: true, xfwd: true }])),
    },
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./src/test/setup.ts'],
      include: ['src/**/*.test.{ts,tsx}'],
      css: false,
      // Form-heavy page tests drive many user-event steps; 5 s is too tight on a busy machine.
      testTimeout: 20_000,
    },
  }
})
