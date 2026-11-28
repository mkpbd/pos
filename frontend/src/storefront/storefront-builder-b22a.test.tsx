import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mockApi, ok, renderRoutes } from '@/test/utils'
import { CanvasApp } from './builder/canvas/canvas-app'
import { envelope, type ParentMessage } from './builder/canvas/protocol'
import { createCanvasQueryClient } from './builder/canvas/query-client'
import { hasPhoneSettings } from './builder/phone-settings'
import { documentOf, elementNode, payloadOf } from './builder/test-payload'
import { DESKTOP_QUERY, TABLET_UP_QUERY } from './components/use-media-query'
import { storefrontRoutes } from './routes'
import { bootstrapFixture, cartFixture, menuNode, resetLocale } from './test-fixtures'
import type { BuilderDocument, BuilderPage, Element } from './builder/types'
import type { StorefrontBootstrap, StorePage } from './types'

/*
 * B22a §3: the designed header on phones — the default compact row, the drawer, a phone layout of
 * the document's own, the fallback without a designed header, and the editor's Phone preview.
 */

afterEach(resetLocale)

function viewport(width: number) {
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) =>
      ({
        matches: (query === TABLET_UP_QUERY && width >= 768) || (query === DESKTOP_QUERY && width >= 1024),
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }) as MediaQueryList,
  )
}

const MENU_DATA = {
  e_menu: { name: 'Main', items: [menuNode('Fruits', '/category/fruits', { children: [menuNode('Mangoes', '/category/mangoes')] }), menuNode('Offers', '/pages/offers')] },
}

function headerDoc(extra: Partial<Element> = {}): BuilderDocument {
  return documentOf([
    elementNode('logo', 'e_logo', { height: 40 }),
    elementNode('menu', 'e_menu', { show_children: 'dropdown' }),
    elementNode('search_box', 'e_search', { placeholder: 'Find fresh food', button_label: 'Go' }),
    elementNode('account_link', 'e_account', { show_label: true }),
    elementNode('wishlist_link', 'e_wish', {}, extra),
    elementNode('cart_icon', 'e_cart', { show_total: true }),
  ])
}

function headerPayload(extra: Partial<Element> = {}): BuilderPage {
  return payloadOf(headerDoc(extra), { key: 'header', title: 'Header', data: MENU_DATA })
}

const aboutPage: StorePage = {
  slug: 'about',
  title: 'About us',
  template: 'default',
  body_html: '<p>About.</p>',
  published_at: null,
  seo_title: null,
  seo_description: null,
  og_image: null,
  faqs: [],
} as unknown as StorePage

function renderStore(builder: StorefrontBootstrap['builder'], layout: Partial<StorefrontBootstrap['theme']['layout']> = {}) {
  const base = bootstrapFixture()
  mockApi({
    'GET /store/bootstrap': ok(bootstrapFixture({ builder, theme: { ...base.theme, layout: { ...base.theme.layout, ...layout } } })),
    'GET /store/pages/about': ok(aboutPage),
    'GET /store/cart': ok(cartFixture()),
    'GET /store/wishlist': ok({ items: [] }),
  })
  renderRoutes(storefrontRoutes, '/pages/about')
}

describe('B22a: phone settings', () => {
  it('counts only what is set for phones', () => {
    expect(hasPhoneSettings(headerPayload())).toBe(false)
    expect(hasPhoneSettings({ sections: headerPayload().sections, device_order: { tablet: { root: ['s_row0'] } } })).toBe(false)
    expect(hasPhoneSettings({ sections: headerPayload().sections, device_order: { mobile: { root: ['s_row0'] } } })).toBe(true)
    expect(hasPhoneSettings(headerPayload({ visibility: { desktop: true, tablet: true, mobile: false } }))).toBe(true)
    expect(hasPhoneSettings(headerPayload({ style: { mobile: {} } } as Partial<Element>))).toBe(false)
    expect(hasPhoneSettings(headerPayload({ style: { tablet: { spacing: { margin: { top: '4px' } } } } } as Partial<Element>))).toBe(false)
    expect(hasPhoneSettings(headerPayload({ style: { mobile: { spacing: { margin: { top: '4px' } } } } } as Partial<Element>))).toBe(true)
    const page = headerPayload()
    const sections = structuredClone(page.sections)
    ;(sections[0]!.columns[0] as { width: Record<string, number> }).width = { base: 100, mobile: 50 }
    expect(hasPhoneSettings({ sections })).toBe(true)
  })
})

describe('B22a: the designed header on phones', () => {
  it('draws the default compact row below 768 px, keeping the sticky setting', async () => {
    viewport(375)
    renderStore({ home: false, header: headerPayload(), footer: null }, { sticky_header: true })
    const header = await screen.findByTestId('site-header')
    expect(header).toHaveAttribute('data-header-style', 'builder')
    expect(header).toHaveClass('sticky')
    const row = within(header).getByTestId('builder-header')
    expect(row).toHaveAttribute('data-phone-layout', 'default')
    expect(within(row).getByRole('link', { name: 'Berry Kids home' })).toHaveAttribute('href', '/')
    expect(within(row).getByRole('button', { name: 'Open search' })).toBeInTheDocument()
    expect(within(row).getByRole('button', { name: /^Cart/ })).toBeInTheDocument()
    expect(within(row).getByRole('button', { name: 'Open menu' })).toHaveAttribute('aria-expanded', 'false')
    // The desktop-only parts stay out of the phone row.
    expect(within(row).queryByPlaceholderText('Find fresh food')).toBeNull()
    expect(within(row).queryByRole('link', { name: 'Wishlist' })).toBeNull()
    expect(within(row).queryByRole('navigation', { name: 'Main' })).toBeNull()
  })

  it('opens a drawer of the header menu: nested rows expand, focus stays inside, Escape closes', async () => {
    viewport(375)
    const user = userEvent.setup()
    renderStore({ home: false, header: headerPayload(), footer: null })
    const header = await screen.findByTestId('site-header')
    const trigger = within(header).getByRole('button', { name: 'Open menu' })
    await user.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')

    const drawer = await screen.findByRole('dialog')
    expect(drawer).toContainElement(document.activeElement as HTMLElement)
    expect(within(drawer).getByRole('link', { name: 'Fruits' })).toHaveAttribute('href', '/category/fruits')
    expect(within(drawer).getByRole('link', { name: 'Offers' })).toBeInTheDocument()
    const expand = within(drawer).getByRole('button', { name: /Fruits/ })
    expect(expand).toHaveAttribute('aria-expanded', 'false')
    expect(within(drawer).queryByRole('link', { name: 'Mangoes' })).toBeNull()
    await user.click(expand)
    expect(expand).toHaveAttribute('aria-expanded', 'true')
    expect(within(drawer).getByRole('link', { name: 'Mangoes' })).toBeInTheDocument()

    // Tabbing never leaves the drawer.
    for (let i = 0; i < 8; i += 1) {
      await user.tab()
      expect(drawer).toContainElement(document.activeElement as HTMLElement)
    }

    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(trigger).toHaveFocus()
  })

  it('draws the document’s own phone layout once something is set for phones', async () => {
    viewport(375)
    renderStore({ home: false, header: headerPayload({ visibility: { desktop: true, tablet: true, mobile: false } }), footer: null })
    const header = await screen.findByTestId('site-header')
    const page = within(header).getByTestId('builder-header')
    expect(page).not.toHaveAttribute('data-phone-layout')
    expect(page).toHaveAttribute('data-b-scope', 'header')
    // The phone overrides are compiled for the phone breakpoint.
    expect(within(page).getByTestId('builder-styles').textContent).toMatch(/@media \(max-width: ?639px\)\{[^@]*\[data-b="e_wish"\]\{display:none/)
    // Menus become a menu button with its drawer, the search box a search icon.
    const menu = within(page).getByTestId('builder-menu')
    expect(within(menu).getByRole('button', { name: 'Open menu' })).toBeInTheDocument()
    expect(within(page).queryByRole('navigation', { name: 'Main' })).toBeNull()
    expect(within(page).getByRole('button', { name: 'Open search' })).toBeInTheDocument()
    expect(within(page).queryByPlaceholderText('Find fresh food')).toBeNull()
    // The rest of the document is drawn as designed.
    expect(within(page).getByRole('link', { name: 'Sign in' })).toBeInTheDocument()
  })

  it('keeps the desktop header from 768 px', async () => {
    viewport(1366)
    renderStore({ home: false, header: headerPayload(), footer: null })
    const header = await screen.findByTestId('site-header')
    expect(header).not.toHaveAttribute('data-header-device')
    expect(within(header).getByRole('navigation', { name: 'Main' })).toBeInTheDocument()
    expect(within(header).getByPlaceholderText('Find fresh food')).toBeInTheDocument()
  })

  it('keeps the compact store header on phones without a designed header', async () => {
    viewport(375)
    renderStore({ home: false, header: null, footer: null })
    const header = await screen.findByTestId('site-header')
    expect(header).not.toHaveAttribute('data-header-style')
    expect(screen.queryByTestId('builder-header')).toBeNull()
    expect(within(header).getByRole('button', { name: 'Open search' })).toHaveAttribute('aria-controls', 'mobile-search')
  })
})

describe('B22a: the editor’s Phone preview of the header', () => {
  const ORIGIN = window.location.origin

  function mount() {
    const posted: { type: string; [key: string]: unknown }[] = []
    vi.spyOn(window, 'postMessage').mockImplementation((data: unknown) => {
      posted.push(data as { type: string })
    })
    render(
      <QueryClientProvider client={createCanvasQueryClient()}>
        <MemoryRouter>
          <CanvasApp parent={window} origin={ORIGIN} />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    const send = (data: ParentMessage) =>
      act(() => void window.dispatchEvent(new MessageEvent('message', { data: envelope(data), origin: ORIGIN, source: window })))
    send({ type: 'init', bootstrap: bootstrapFixture(), locale: 'en' })
    return { posted, send }
  }

  const frame = (page: BuilderPage, overrides: Partial<Extract<ParentMessage, { type: 'render' }>> = {}): ParentMessage => ({
    type: 'render',
    sections: page.sections,
    data: page.data,
    media: page.media,
    selection: null,
    hover: null,
    errors: [],
    device: 'mobile',
    pending: [],
    surroundings: 'header',
    ...overrides,
  })

  it('shows the default phone row, whose parts select their elements', async () => {
    const { posted, send } = mount()
    send(frame(headerPayload()))
    const part = await waitFor(() => {
      const found = document.querySelector('[data-canvas-part="header"] [data-phone-layout="default"]')
      expect(found).not.toBeNull()
      return found as HTMLElement
    })
    expect(screen.getByTestId('canvas-phone-note')).toHaveTextContent('logo, search, cart and a menu button')
    for (const id of ['e_logo', 'e_search', 'e_cart', 'e_menu']) expect(part.querySelector(`[data-b="${id}"]`)).not.toBeNull()

    // Clicking a part selects its element (and never opens the drawer).
    within(part).getByRole('button', { name: 'Open menu' }).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    expect(posted.at(-1)).toMatchObject({ type: 'click', id: 'e_menu' })
    expect(screen.queryByRole('dialog')).toBeNull()

    // Tablet and desktop previews draw the document as before.
    send(frame(headerPayload(), { device: 'tablet' }))
    await waitFor(() => expect(document.querySelector('[data-phone-layout]')).toBeNull())
    expect(screen.queryByTestId('canvas-phone-note')).toBeNull()
  })

  it('switches to the document’s phone layout once the editor sets something for Phone', async () => {
    const { send } = mount()
    send(frame(headerPayload()))
    await screen.findByTestId('canvas-phone-note')
    send(frame(headerPayload(), { device_order: { mobile: { c_row0: ['e_cart', 'e_logo'] } } }))
    await waitFor(() => expect(screen.getByTestId('canvas-phone-note')).toHaveTextContent('with its Phone settings'))
    const header = document.querySelector<HTMLElement>('[data-canvas-part="header"]')!
    expect(header.querySelector('[data-phone-layout]')).toBeNull()
    // The phone order is drawn; the menu is a menu button, the search an icon.
    const ids = Array.from(header.querySelectorAll<HTMLElement>('.b-col > [data-b]')).map((el) => el.dataset.b)
    expect(ids.slice(0, 2)).toEqual(['e_cart', 'e_logo'])
    expect(within(within(header).getByTestId('builder-menu')).getByRole('button', { name: 'Open menu' })).toBeInTheDocument()
    expect(within(header).getByRole('button', { name: 'Open search' })).toBeInTheDocument()
  })
})
