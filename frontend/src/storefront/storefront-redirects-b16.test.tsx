import { screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fail, mockApi, ok, renderRoutes } from '@/test/utils'
import { redirectDestination, resetRedirectHops } from './redirects'
import { storefrontRoutes } from './routes'
import { bootstrapFixture, resetLocale } from './test-fixtures'

/*
 * B16 §5: the store's "Page not found" asks GET /store/redirects/resolve for the address and, when
 * it has a redirect, replaces the location with the new address (query and anchor kept); without one
 * (or when the lookup fails) the 404 shows as before.
 */

beforeEach(() => resetRedirectHops())
afterEach(() => resetLocale())

const here = { pathname: '/p/eid-2025', search: '?utm_source=fb', hash: '' }

describe('redirectDestination', () => {
  it('keeps the shopper’s query and anchor unless the redirect has its own', () => {
    expect(redirectDestination('/p/eid-2026', here, 'http://localhost')).toEqual({ internal: '/p/eid-2026?utm_source=fb' })
    expect(redirectDestination('/p/eid-2026?ref=x#buy', here, 'http://localhost')).toEqual({ internal: '/p/eid-2026?ref=x#buy' })
    expect(redirectDestination('/p/eid-2026', { ...here, hash: '#top' }, 'http://localhost')).toEqual({ internal: '/p/eid-2026?utm_source=fb#top' })
  })

  it('treats a full address of this store as a path and another site as external', () => {
    expect(redirectDestination('http://localhost/shop', here, 'http://localhost')).toEqual({ internal: '/shop?utm_source=fb' })
    expect(redirectDestination('https://facebook.com/eid', here, 'http://localhost')).toEqual({ external: 'https://facebook.com/eid' })
  })

  it('ignores a redirect to the same address and anything that is not an address', () => {
    expect(redirectDestination('/p/eid-2025/', here, 'http://localhost')).toBeNull()
    expect(redirectDestination('javascript:alert(1)', here, 'http://localhost')).toBeNull()
    expect(redirectDestination('//evil.example/x', here, 'http://localhost')).toBeNull()
    expect(redirectDestination('', here, 'http://localhost')).toBeNull()
  })
})

describe('client redirect on a 404', () => {
  it('replaces the location with the new address, keeping the query, and asks once per path', async () => {
    const fetchMock = mockApi({
      'GET /store/bootstrap': ok(bootstrapFixture()),
      'GET /store/redirects/resolve': (_init, url) => (url.searchParams.get('path') === '/old-offer' ? ok({ to: '/shop', type: 301 }) : ok(null)),
      'GET /store/products': ok([], { pagination: { current_page: 1, per_page: 24, total: 0, last_page: 1 } }),
    })
    const { router } = renderRoutes(storefrontRoutes, '/old-offer?utm_source=fb')
    await waitFor(() => expect(router.state.location.pathname).toBe('/shop'))
    expect(router.state.location.search).toBe('?utm_source=fb')
    // Replaced, so Back doesn't return to the dead address.
    expect(router.state.historyAction).toBe('REPLACE')
    const resolves = fetchMock.mock.calls.map(([input]) => new URL(String(input), 'http://localhost')).filter((u) => u.pathname === '/api/v1/store/redirects/resolve')
    expect(resolves).toHaveLength(1)
    expect(resolves[0]!.searchParams.get('path')).toBe('/old-offer')
    expect(resolves[0]!.searchParams.has('lang')).toBe(false)
  })

  it('shows "Page not found" when the address has no redirect', async () => {
    mockApi({ 'GET /store/bootstrap': ok(bootstrapFixture()), 'GET /store/redirects/resolve': ok(null) })
    const { router } = renderRoutes(storefrontRoutes, '/no-such-page')
    expect(await screen.findByRole('heading', { level: 1, name: 'Page not found' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/no-such-page')
  })

  it('shows "Page not found" when the lookup fails', async () => {
    mockApi({ 'GET /store/bootstrap': ok(bootstrapFixture()), 'GET /store/redirects/resolve': fail(500, 'SERVER_ERROR') })
    renderRoutes(storefrontRoutes, '/no-such-page')
    expect(await screen.findByRole('heading', { level: 1, name: 'Page not found' })).toBeInTheDocument()
  })

  it('follows a redirect from a missing product to its new address', async () => {
    mockApi({
      'GET /store/bootstrap': ok(bootstrapFixture()),
      'GET /store/products/old-saree': fail(404, 'NOT_FOUND'),
      'GET /store/products/red-saree': fail(404, 'NOT_FOUND'),
      'GET /store/redirects/resolve': (_init, url) => (url.searchParams.get('path') === '/product/old-saree' ? ok({ to: '/product/red-saree', type: 301 }) : ok(null)),
    })
    const { router } = renderRoutes(storefrontRoutes, '/product/old-saree')
    await waitFor(() => expect(router.state.location.pathname).toBe('/product/red-saree'))
  })

  it('sends shoppers to another site with location.replace', async () => {
    const replace = vi.fn()
    vi.stubGlobal('location', { ...window.location, origin: 'http://localhost', replace })
    mockApi({ 'GET /store/bootstrap': ok(bootstrapFixture()), 'GET /store/redirects/resolve': ok({ to: 'https://facebook.com/greenbasket', type: 302 }) })
    renderRoutes(storefrontRoutes, '/facebook')
    await waitFor(() => expect(replace).toHaveBeenCalledWith('https://facebook.com/greenbasket'))
    expect(screen.queryByRole('heading', { name: 'Page not found' })).toBeNull()
  })

  it('stops a ping-pong between two addresses and shows "Page not found"', async () => {
    mockApi({
      'GET /store/bootstrap': ok(bootstrapFixture()),
      'GET /store/redirects/resolve': (_init, url) => ok({ to: url.searchParams.get('path') === '/a' ? '/b' : '/a', type: 301 }),
    })
    const { router } = renderRoutes(storefrontRoutes, '/a')
    expect(await screen.findByRole('heading', { level: 1, name: 'Page not found' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/a')
  })
})
