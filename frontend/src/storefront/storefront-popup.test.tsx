import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockApi, ok, renderRoutes } from '@/test/utils'
import { resetPopupMemory } from './popup/frequency'
import { storefrontRoutes } from './routes'
import { bootstrapFixture, popupFixture } from './test-fixtures'
import type { StorePopup } from './types'

const aboutPage = { slug: 'about', title: 'About us', template: 'default', body_html: '<p>Since 2020.</p>', published_at: null, seo_title: null, seo_description: null, updated_at: null }

function serve(popup: StorePopup | null) {
  return mockApi({
    'GET /store/bootstrap': ok(bootstrapFixture({ popup })),
    'GET /store/pages/about': ok(aboutPage),
    'GET /store/homepage': ok({ sections: [], preview: false }),
  })
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  resetPopupMemory()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('storefront popup banner', () => {
  it('opens after its delay as a labelled dialog and closes with Esc, returning focus', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    serve(popupFixture({ delay_seconds: 5 }))
    renderRoutes(storefrontRoutes, '/pages/about')
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    await screen.findByRole('heading', { level: 1, name: 'About us' })
    const skip = screen.getByRole('link', { name: 'Skip to content' })
    skip.focus()

    await act(() => vi.advanceTimersByTimeAsync(4_000))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await act(() => vi.advanceTimersByTimeAsync(1_500))

    const dialog = await screen.findByRole('dialog', { name: 'Free delivery over ৳3000' })
    expect(dialog).toHaveAccessibleDescription('This week only, anywhere in Dhaka.')
    expect(within(dialog).getByRole('link', { name: 'Shop now' })).toHaveAttribute('href', '/shop')
    expect(dialog.querySelector('img')).toHaveAttribute('src', '/storage/media/o/popup.jpg')
    await waitFor(() => expect(dialog).toContainElement(document.activeElement as HTMLElement))

    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(skip).toHaveFocus()
  })

  it('keeps focus inside and closes with the close button', async () => {
    serve(popupFixture())
    renderRoutes(storefrontRoutes, '/')
    const user = userEvent.setup()

    const dialog = await screen.findByRole('dialog', { name: 'Free delivery over ৳3000' })
    const close = within(dialog).getByRole('button', { name: 'Close' })
    for (let i = 0; i < 4; i += 1) {
      await user.tab()
      expect(dialog).toContainElement(document.activeElement as HTMLElement)
    }
    await user.click(close)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('closes when its link is followed', async () => {
    serve(popupFixture({ link_url: '/pages/about', button_label: 'Read more' }))
    const { router } = renderRoutes(storefrontRoutes, '/')
    const user = userEvent.setup()

    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('link', { name: 'Read more' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'About us' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/pages/about')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('is not shown again within its frequency, but is after a day', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(new Date('2026-11-01T10:00:00Z'))
    serve(popupFixture({ frequency: 'once_per_day' }))
    const first = renderRoutes(storefrontRoutes, '/pages/about')
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    first.unmount()

    // A new page load the same day.
    resetPopupMemory()
    const second = renderRoutes(storefrontRoutes, '/pages/about')
    await screen.findByRole('heading', { level: 1, name: 'About us' })
    await act(() => vi.advanceTimersByTimeAsync(1_000))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    second.unmount()

    vi.setSystemTime(new Date('2026-11-02T10:30:00Z'))
    resetPopupMemory()
    renderRoutes(storefrontRoutes, '/pages/about')
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
  })

  it('still shows once per visit when storage is blocked', async () => {
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('Blocked', 'SecurityError')
    })
    serve(popupFixture())
    const first = renderRoutes(storefrontRoutes, '/pages/about')
    const user = userEvent.setup()

    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Close' }))
    first.unmount()

    renderRoutes(storefrontRoutes, '/pages/about')
    await screen.findByRole('heading', { level: 1, name: 'About us' })
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('waits until the visitor leaves cart, checkout and account pages', async () => {
    serve(popupFixture())
    const { router } = renderRoutes(storefrontRoutes, '/cart')

    await screen.findByRole('heading', { level: 1, name: /cart/i })
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    await act(() => router.navigate('/pages/about'))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
  })

  it('names an untitled popup and leaves out what it does not have', async () => {
    serve(popupFixture({ title: null, subtitle: null, button_label: null, link_url: null, image: null }))
    renderRoutes(storefrontRoutes, '/')

    const dialog = await screen.findByRole('dialog', { name: 'Special offer' })
    expect(dialog).not.toHaveAttribute('aria-describedby')
    expect(within(dialog).queryByRole('link')).not.toBeInTheDocument()
  })

  it('makes the image the link when there is no button', async () => {
    serve(popupFixture({ button_label: null }))
    renderRoutes(storefrontRoutes, '/')

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('link', { name: 'Free delivery over ৳3000' })).toHaveAttribute('href', '/shop')
  })

  it('shows nothing without a live popup', async () => {
    serve(null)
    renderRoutes(storefrontRoutes, '/pages/about')
    await screen.findByRole('heading', { level: 1, name: 'About us' })
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
