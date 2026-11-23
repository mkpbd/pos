import { act, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { routes } from '@/app/routes'
import { makeCurrentUser } from '@/test/fixtures'
import { mockApi, ok, renderRoutes } from '@/test/utils'

type Listener = () => void

/** A controllable matchMedia: `width` decides `(max-width: 767.98px)`. */
function fakeScreen(initialWidth: number) {
  let width = initialWidth
  const listeners = new Set<Listener>()
  vi.stubGlobal('matchMedia', (query: string) => ({
    get matches() {
      const max = /max-width:\s*([\d.]+)px/.exec(query)
      return max ? width <= Number(max[1]) : false
    },
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: (_: string, l: Listener) => listeners.add(l),
    removeEventListener: (_: string, l: Listener) => listeners.delete(l),
    dispatchEvent: () => false,
  }))
  return {
    resize(next: number) {
      width = next
      act(() => listeners.forEach((l) => l()))
    },
  }
}

const builder = () => {
  const me = makeCurrentUser()
  return { ...me, permissions: [...me.permissions, 'storefront.view', 'storefront.manage'] }
}

const original = window.matchMedia
afterEach(() => {
  window.matchMedia = original
})

describe('Page builder on a phone (Q1 §8)', () => {
  it('shows a notice with a way back instead of the editor below 768 px', async () => {
    fakeScreen(390)
    const fetchMock = mockApi({ 'GET /auth/me': ok(builder()) })
    renderRoutes(routes, '/storefront/builder/doc-1')

    expect(await screen.findByRole('heading', { name: 'Open the page builder on a bigger screen' })).toBeInTheDocument()
    expect(screen.getByText('The page builder works on a computer or tablet — open this page there.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to pages' })).toHaveAttribute('href', '/storefront/pages')
    // The editor's data is not even fetched.
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/storefront/builder/documents'))).toBe(false)
  })

  it('opens the editor once the screen is wide enough (rotating a tablet)', async () => {
    const screenSize = fakeScreen(700)
    const fetchMock = mockApi({ 'GET /auth/me': ok(builder()) })
    renderRoutes(routes, '/storefront/builder/doc-1')

    await screen.findByRole('heading', { name: 'Open the page builder on a bigger screen' })
    screenSize.resize(1024)

    expect(screen.queryByRole('heading', { name: 'Open the page builder on a bigger screen' })).not.toBeInTheDocument()
    await vi.waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/storefront/builder/documents/doc-1'))).toBe(true))
  })
})
