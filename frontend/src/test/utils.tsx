import type { ReactElement } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import { createMemoryRouter, RouterProvider, type RouteObject } from 'react-router'
import { vi } from 'vitest'

export function createTestQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
}

/** Render a route tree in memory with a fresh, non-retrying QueryClient. */
export function renderRoutes(routes: RouteObject[], initialPath = '/') {
  const router = createMemoryRouter(routes, { initialEntries: [initialPath] })
  const queryClient = createTestQueryClient()
  return {
    router,
    ...render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    ),
  }
}

export function renderWithQuery(ui: ReactElement) {
  return render(<QueryClientProvider client={createTestQueryClient()}>{ui}</QueryClientProvider>)
}

type MockReply = { status?: number; body?: unknown }
type MockHandler = MockReply | ((init: RequestInit, url: URL) => MockReply)

/**
 * Stub fetch with per-route replies keyed by "METHOD /path" (path without /api/v1 and query).
 * Unmatched requests fail the test loudly with a 599 so missing mocks are obvious.
 */
export function mockApi(routes: Record<string, MockHandler>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input), 'http://localhost')
    const key = `${(init.method ?? 'GET').toUpperCase()} ${url.pathname.replace(/^\/api\/v1/, '')}`
    const handler = routes[key]
    if (!handler) {
      return new Response(JSON.stringify({ success: false, error: { code: 'UNMOCKED', message: `No mock for ${key}`, details: {} }, meta: { request_id: null } }), { status: 599 })
    }
    const reply = typeof handler === 'function' ? handler(init, url) : handler
    return reply.status === 204
      ? new Response(null, { status: 204 })
      : new Response(JSON.stringify(reply.body ?? null), { status: reply.status ?? 200, headers: { 'Content-Type': 'application/json' } })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

export const ok = (data: unknown, meta: Record<string, unknown> = {}): MockReply => ({ body: { success: true, data, meta: { request_id: 'test', ...meta } } })

export const fail = (status: number, code: string, message = code, details: Record<string, unknown> = {}): MockReply => ({
  status,
  body: { success: false, error: { code, message, details }, meta: { request_id: 'test' } },
})

/** Stub global fetch with a JSON response. */
export function mockFetchJson(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  const fetchMock = vi.fn(async () =>
    new Response(JSON.stringify(body), {
      status: init.status ?? 200,
      headers: { 'Content-Type': 'application/json', ...init.headers },
    }),
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}
