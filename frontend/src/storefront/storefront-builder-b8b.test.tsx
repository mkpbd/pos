import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fail, mockApi, ok, renderRoutes } from '@/test/utils'
import { readFields, submitValues, fieldError, initialValues } from './builder/elements/form-values'
import { readPopups } from './builder/popups/api'
import { isPopupDue, markPopupActed, markPopupShown, matchesAudience, matchesDevice, matchesPage, readPopupRecord, resetPopupRecords } from './builder/popups/rules'
import { armTrigger } from './builder/popups/triggers'
import { documentContext, elementMeta, isAllowedIn, isTranslatableKey } from './builder/registry'
import { documentOf, elementNode, payloadOf } from './builder/test-payload'
import type { BuilderDocument, BuilderPage, Element, FormField, StorePopupEntry, StorePopupSettings } from './builder/types'
import { b8bPropProblems, elementPropProblems, normalizePopupSettings, normalizeStorePopupSettings, POPUP_DEFAULTS, popupSettingsProblems } from './builder/validate'
import { storefrontRoutes } from './routes'
import { bootstrapFixture, cartFixture, resetLocale } from './test-fixtures'
import type { StorePage } from './types'

const uuid = (n: number) => `0199a5c1-0000-7000-8000-${n.toString(16).padStart(12, '0')}`
const POPUP_A = uuid(0xb8b0a)
const POPUP_B = uuid(0xb8b0b)
const POPUP_C = uuid(0xb8b0c)

beforeEach(() => {
  resetPopupRecords()
  window.localStorage.clear()
  window.sessionStorage.clear()
})

afterEach(() => {
  resetLocale()
  vi.useRealTimers()
  document.body.removeAttribute('style')
  document.documentElement.style.removeProperty('--sf-popup-bar-top')
  document.documentElement.style.removeProperty('--sf-popup-bar-bottom')
})

/** matchMedia answering `true` for the given queries (setup.ts answers false to everything). */
function stubMedia(matching: string[]) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: matching.includes(query),
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }))
}

/* ---------------------------------------------------------------------------------------------
 * Shared types, registry and validators
 * ------------------------------------------------------------------------------------------- */

describe('B8b registry and validators', () => {
  it('knows popup documents and what may sit in them', () => {
    expect(documentContext(`popup:${POPUP_A}`)).toBe('popup')
    for (const type of ['heading', 'text', 'image', 'button', 'spacer', 'divider', 'inner_row', 'cta', 'discount', 'countdown', 'newsletter_form', 'notice', 'icon_list', 'marquee', 'video', 'social_icons', 'payment_icons', 'custom_html', 'form']) {
      expect(isAllowedIn(type, 'popup'), type).toBe(true)
    }
    for (const type of ['product_grid', 'hero_slider', 'chart', 'map', 'menu', 'logo', 'gallery', 'contact_form']) expect(isAllowedIn(type, 'popup'), type).toBe(false)
    expect(isAllowedIn('form', 'page') && isAllowedIn('form', 'cms') && isAllowedIn('form', 'zone')).toBe(true)
    expect(isAllowedIn('form', 'header') || isAllowedIn('form', 'footer')).toBe(false)
  })

  it('has a valid default form with the server’s ids and translatable field texts', () => {
    const meta = elementMeta('form')!
    expect(elementPropProblems('form', meta.props)).toEqual([])
    expect((meta.props.fields as FormField[]).map((f) => f.id)).toEqual(['f_name', 'f_email', 'f_message'])
    expect(isTranslatableKey('form', 'fields.f_name.label')).toBe(true)
    expect(isTranslatableKey('form', 'fields.f_topic.options.o_1.label')).toBe(true)
    expect(isTranslatableKey('form', 'consent.text')).toBe(true)
    expect(isTranslatableKey('form', 'notify_email')).toBe(false)
  })

  it('checks popup settings like the server', () => {
    expect(popupSettingsProblems(POPUP_DEFAULTS)).toEqual([])
    const bad = (patch: Record<string, unknown>) => popupSettingsProblems({ ...POPUP_DEFAULTS, ...patch })
    expect(bad({ trigger: { kind: 'on_load', delay_seconds: 121, scroll_percent: 50 } })).toContainEqual({ path: 'trigger.delay_seconds', code: 'out_of_range' })
    expect(bad({ trigger: { kind: 'on_scroll', delay_seconds: 0, scroll_percent: 95 } })).toContainEqual({ path: 'trigger.scroll_percent', code: 'out_of_range' })
    expect(bad({ frequency: { kind: 'once_every_days', days: 0 } })).toContainEqual({ path: 'frequency.days', code: 'out_of_range' })
    expect(bad({ pages: { kind: 'paths', paths: [] } })).toContainEqual({ path: 'pages.paths', code: 'too_few' })
    expect(bad({ pages: { kind: 'paths', paths: ['/p/eid-sale', '/checkout/step', '/P/Upper', '/p/eid-sale'] } })).toEqual([
      { path: 'pages.paths.1', code: 'invalid' },
      { path: 'pages.paths.2', code: 'invalid' },
      { path: 'pages.paths.3', code: 'duplicate' },
    ])
    expect(bad({ starts_at: '2026-12-01T00:00:00+06:00', ends_at: '2026-11-01T00:00:00+06:00' })).toContainEqual({ path: 'ends_at', code: 'out_of_range' })
    expect(bad({ layout: 'popover', priority: 101 })).toEqual([
      { path: 'layout', code: 'invalid' },
      { path: 'priority', code: 'out_of_range' },
    ])
    expect(bad({ label: 'x'.repeat(121) })).toContainEqual({ path: 'label', code: 'too_long' })
  })

  it('fills every popup setting when normalizing (public settings drop the schedule and translations)', () => {
    expect(normalizePopupSettings({ layout: 'bar_top', trigger: { kind: 'on_exit' }, pages: { kind: 'paths', paths: ['/p/x', 'javascript:x'] } })).toEqual({
      ...POPUP_DEFAULTS,
      layout: 'bar_top',
      trigger: { ...POPUP_DEFAULTS.trigger, kind: 'on_exit' },
      pages: { kind: 'paths', paths: ['/p/x'] },
    })
    const store = normalizeStorePopupSettings({ ...POPUP_DEFAULTS, starts_at: '2026-01-01T00:00:00Z', translations: { bn: { label: 'অফার' } } })
    expect(store).not.toHaveProperty('starts_at')
    expect(store).not.toHaveProperty('translations')
  })

  it('checks form props and the button action', () => {
    const form = structuredClone(elementMeta('form')!.props) as Record<string, unknown> & { fields: FormField[] }
    const field = (patch: Partial<FormField>): FormField => ({ id: 'f_x', kind: 'text', label: 'X', placeholder: '', help: '', required: false, options: [], min: null, max: null, max_length: null, reply_to: false, ...patch })
    const problems = b8bPropProblems('form', {
      ...form,
      fields: [
        field({ id: 'f_pick', kind: 'select', options: [{ id: 'o_1', label: 'Only' }] }),
        field({ id: 'f_text', reply_to: true, min: 1 }),
        field({ id: 'f_mail', kind: 'email', reply_to: true, max_length: 10 }),
        field({ id: 'f_mail2', kind: 'email', reply_to: true }),
        field({ id: 'f_num', kind: 'number', min: 10, max: 5 }),
        field({ id: 'f_long', kind: 'textarea', max_length: 2001, label: '' }),
      ],
      consent: { text: '', link: { url: 'javascript:alert(1)' } },
      notify_email: 'not an address',
      submit_label: '',
    })
    expect(problems).toEqual(
      expect.arrayContaining([
        { path: 'fields.0.options', code: 'too_few' },
        { path: 'fields.1.min', code: 'invalid' },
        { path: 'fields.1.reply_to', code: 'invalid' },
        { path: 'fields.2.max_length', code: 'invalid' },
        { path: 'fields.3.reply_to', code: 'duplicate' },
        { path: 'fields.4.max', code: 'out_of_range' },
        { path: 'fields.5.label', code: 'required' },
        { path: 'fields.5.max_length', code: 'out_of_range' },
        { path: 'consent.text', code: 'required' },
        { path: 'consent.link', code: 'invalid' },
        { path: 'notify_email', code: 'invalid' },
        { path: 'submit_label', code: 'required' },
      ]),
    )
    expect(b8bPropProblems('form', { ...form, fields: [] })).toContainEqual({ path: 'fields', code: 'too_few' })
    expect(b8bPropProblems('button', { action: 'dismiss' }, 'popup')).toEqual([])
    expect(b8bPropProblems('button', { action: 'dismiss' }, 'page')).toEqual([{ path: 'action', code: 'invalid' }])
    expect(b8bPropProblems('button', { action: 'explode' })).toEqual([{ path: 'action', code: 'invalid' }])
  })

  // The backend agent's round-trip fixtures (when present): every popup and form in them is valid here too.
  const fixtures = import.meta.glob<{ default: BuilderDocument }>('./builder/__fixtures__/sample-{popup,b8b-form}.v1.json', { eager: true })
  it.each(Object.entries(fixtures).map(([name, module]) => ({ name, doc: module.default })))('accepts the fixture $name', ({ doc }) => {
    if (doc.popup) expect(popupSettingsProblems(doc.popup)).toEqual([])
    const walk = (nodes: unknown[]): Element[] =>
      (nodes as (Element & { columns?: { elements: unknown[] }[] })[]).flatMap((node) => [
        ...((node.type as string) === 'section' ? [] : [node]),
        ...(node.columns ?? []).flatMap((column) => walk(column.elements)),
      ])
    for (const node of walk(doc.sections)) {
      if (doc.popup) expect(isAllowedIn(node.type, 'popup'), node.type).toBe(true)
      expect(elementPropProblems(node.type, node.props), node.id).toEqual([])
    }
  })
})

/* ---------------------------------------------------------------------------------------------
 * Rules, frequency and triggers
 * ------------------------------------------------------------------------------------------- */

const settings = (patch: Partial<StorePopupSettings> = {}): StorePopupSettings => ({
  ...normalizeStorePopupSettings({}),
  trigger: { kind: 'on_load', delay_seconds: 0, scroll_percent: 50 },
  ...patch,
})

describe('popup rules', () => {
  it('matches pages and never covers checkout, cart, account or order pages', () => {
    const on = (pages: StorePopupSettings['pages'], path: string, neverOn: string[] = []) => matchesPage({ pages }, path, neverOn)
    expect(on({ kind: 'all', paths: [] }, '/pages/about')).toBe(true)
    for (const path of ['/checkout', '/cart', '/account', '/account/orders', '/order/1001', '/orders']) expect(on({ kind: 'all', paths: [] }, path), path).toBe(false)
    expect(on({ kind: 'all', paths: [] }, '/blog', ['/blog'])).toBe(false)
    expect(on({ kind: 'home', paths: [] }, '/')).toBe(true)
    expect(on({ kind: 'home', paths: [] }, '/shop')).toBe(false)
    for (const path of ['/shop', '/search', '/category/tea', '/brand/acme', '/product/green-tea']) expect(on({ kind: 'shop', paths: [] }, path), path).toBe(true)
    expect(on({ kind: 'shop', paths: [] }, '/shopping-guide')).toBe(false)
    expect(on({ kind: 'paths', paths: ['/p/eid-sale'] }, '/p/eid-sale')).toBe(true)
    expect(on({ kind: 'paths', paths: ['/p/eid-sale'] }, '/p/eid-sale/more')).toBe(true)
    expect(on({ kind: 'paths', paths: ['/p/eid-sale'] }, '/p/eid-sale-2')).toBe(false)
  })

  it('matches devices and audiences (an unknown visitor only sees popups for everyone)', () => {
    expect(matchesDevice({ devices: 'mobile' }, true)).toBe(true)
    expect(matchesDevice({ devices: 'mobile' }, false)).toBe(false)
    expect(matchesDevice({ devices: 'desktop' }, false)).toBe(true)
    expect(matchesDevice({ devices: 'all' }, true)).toBe(true)
    expect(matchesAudience({ audience: 'guests' }, false)).toBe(true)
    expect(matchesAudience({ audience: 'guests' }, true)).toBe(false)
    expect(matchesAudience({ audience: 'signed_in' }, true)).toBe(true)
    expect(matchesAudience({ audience: 'signed_in' }, null)).toBe(false)
    expect(matchesAudience({ audience: 'all' }, null)).toBe(true)
  })

  it('remembers shows in localStorage and applies each frequency', () => {
    const now = Date.UTC(2026, 10, 12)
    const days = settings({ frequency: { kind: 'once_every_days', days: 7 } })
    expect(isPopupDue(POPUP_A, days, now)).toBe(true)
    markPopupShown(POPUP_A, now)
    expect(JSON.parse(window.localStorage.getItem(`sf.popup.${POPUP_A}`)!)).toEqual({ shown: now, closes: 0, acted: null })
    expect(isPopupDue(POPUP_A, days, now + 6 * 86_400_000)).toBe(false)
    expect(isPopupDue(POPUP_A, days, now + 7 * 86_400_000)).toBe(true)
    expect(isPopupDue(POPUP_A, settings({ frequency: { kind: 'once_forever', days: 7 } }), now + 1000 * 86_400_000)).toBe(false)
    expect(isPopupDue(POPUP_A, settings({ frequency: { kind: 'once_per_session', days: 7 } }))).toBe(false)
    expect(isPopupDue(POPUP_A, settings({ frequency: { kind: 'every_page_view', days: 7 }, stop_after_action: true }))).toBe(true)

    // A new session (sessionStorage and this page's memory gone): once per session is due again.
    resetPopupRecords()
    window.sessionStorage.clear()
    expect(isPopupDue(POPUP_A, settings({ frequency: { kind: 'once_per_session', days: 7 } }))).toBe(true)

    markPopupActed(POPUP_A, now)
    expect(isPopupDue(POPUP_A, settings({ frequency: { kind: 'every_page_view', days: 7 }, stop_after_action: true }))).toBe(false)
    expect(isPopupDue(POPUP_A, settings({ frequency: { kind: 'every_page_view', days: 7 }, stop_after_action: false }))).toBe(true)
  })

  it('falls back to this page’s memory when storage is blocked (at most once per page load)', () => {
    const blocked = () => {
      throw new DOMException('blocked', 'SecurityError')
    }
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(blocked)
    vi.spyOn(window, 'sessionStorage', 'get').mockImplementation(blocked)
    const forever = settings({ frequency: { kind: 'once_forever', days: 7 } })
    expect(isPopupDue(POPUP_B, forever)).toBe(true)
    expect(() => markPopupShown(POPUP_B)).not.toThrow()
    expect(isPopupDue(POPUP_B, forever)).toBe(false)
    expect(isPopupDue(POPUP_B, settings({ frequency: { kind: 'once_per_session', days: 7 } }))).toBe(false)
    expect(readPopupRecord(POPUP_B).shown).not.toBeNull()
  })

  it('ignores a corrupt record', () => {
    window.localStorage.setItem(`sf.popup.${POPUP_C}`, '{not json')
    expect(readPopupRecord(POPUP_C)).toEqual({ shown: null, closes: 0, acted: null })
  })
})

describe('popup triggers', () => {
  it('fires on load after the delay, once', () => {
    vi.useFakeTimers()
    const fire = vi.fn()
    armTrigger({ kind: 'on_load', delay_seconds: 8, scroll_percent: 50 }, fire)
    vi.advanceTimersByTime(7999)
    expect(fire).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    vi.advanceTimersByTime(20_000)
    expect(fire).toHaveBeenCalledTimes(1)
  })

  it('fires after scrolling past the percentage (a page too short to scroll counts after a moment)', () => {
    vi.useFakeTimers()
    const fire = vi.fn()
    vi.spyOn(document.documentElement, 'scrollHeight', 'get').mockReturnValue(3000)
    window.innerHeight = 1000
    const off = armTrigger({ kind: 'on_scroll', delay_seconds: 0, scroll_percent: 40 }, fire)
    window.scrollY = 700 // 35 % of the 2000 px that scroll
    window.dispatchEvent(new Event('scroll'))
    expect(fire).not.toHaveBeenCalled()
    window.scrollY = 800
    window.dispatchEvent(new Event('scroll'))
    expect(fire).toHaveBeenCalledTimes(1)
    off()
    window.scrollY = 0

    vi.spyOn(document.documentElement, 'scrollHeight', 'get').mockReturnValue(500)
    const short = vi.fn()
    armTrigger({ kind: 'on_scroll', delay_seconds: 0, scroll_percent: 40 }, short)
    vi.advanceTimersByTime(2000)
    expect(short).toHaveBeenCalledTimes(1)
  })

  it('fires on exit intent with a mouse, and after the fallback delay on touch screens', () => {
    vi.useFakeTimers()
    stubMedia(['(hover: hover) and (pointer: fine)'])
    const fire = vi.fn()
    const off = armTrigger({ kind: 'on_exit', delay_seconds: 20, scroll_percent: 50 }, fire)
    document.dispatchEvent(new MouseEvent('mouseout', { clientY: 300, relatedTarget: null }))
    vi.advanceTimersByTime(60_000)
    expect(fire).not.toHaveBeenCalled()
    document.dispatchEvent(new MouseEvent('mouseout', { clientY: 0, relatedTarget: null }))
    expect(fire).toHaveBeenCalledTimes(1)
    off()

    stubMedia([])
    const touch = vi.fn()
    armTrigger({ kind: 'on_exit', delay_seconds: 0, scroll_percent: 50 }, touch)
    vi.advanceTimersByTime(19_999)
    expect(touch).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(touch).toHaveBeenCalledTimes(1)
  })

  it('disarms cleanly', () => {
    vi.useFakeTimers()
    const fire = vi.fn()
    const off = armTrigger({ kind: 'on_load', delay_seconds: 1, scroll_percent: 50 }, fire)
    off()
    vi.advanceTimersByTime(5000)
    expect(fire).not.toHaveBeenCalled()
  })

  it('reads whatever the popups endpoint returns defensively', () => {
    const page = payloadOf(documentOf([elementNode('heading', 'e_h')]))
    const read = readPopups({ popups: [{ id: POPUP_A, version: 2, settings: { layout: 'bar_top' }, payload: page }, { id: '', payload: page }, { id: POPUP_B }, 'x'], never_on: ['/checkout', 5] })
    expect(read.popups).toHaveLength(1)
    expect(read.popups[0]!.settings.layout).toBe('bar_top')
    expect(read.never_on).toEqual(['/checkout'])
    expect(readPopups(null)).toEqual({ popups: [], never_on: [] })
  })
})

/* ---------------------------------------------------------------------------------------------
 * PopupHost on the store
 * ------------------------------------------------------------------------------------------- */

const classicPage = (slug: string): StorePage => ({ slug, title: slug === 'about' ? 'About us' : 'FAQ', template: 'default', body_html: '<p>Classic page</p>', published_at: null, seo_title: null, seo_description: null, updated_at: null })

function popupEntry(id: string, patch: Partial<StorePopupSettings>, elements: Element[], version: number | null = 1): StorePopupEntry {
  const page = payloadOf(documentOf(elements), { key: `popup:${id}` })
  return { id, version, settings: settings(patch), payload: { sections: page.sections, media: page.media, data: page.data } }
}

const offerElements = (prefix: string, title = 'Join our list') => [
  elementNode('heading', `e_${prefix}_h`, { text: title, level: 2 }),
  elementNode('text', `e_${prefix}_t`, { html: '<p>Fresh deals every week.</p>' }),
  elementNode('button', `e_${prefix}_b`, { label: 'Shop now', link: { url: '/shop' } }),
]

type Routes = Parameters<typeof mockApi>[0]

function renderStore(popups: StorePopupEntry[] | ((url: URL) => StorePopupEntry[]), { path = '/pages/about', routes = {}, neverOn = ['/checkout', '/cart', '/account', '/order'] }: { path?: string; routes?: Routes; neverOn?: string[] } = {}) {
  const fetchMock = mockApi({
    'GET /store/bootstrap': ok(bootstrapFixture()),
    'GET /store/pages/about': ok(classicPage('about')),
    'GET /store/pages/faq': ok(classicPage('faq')),
    'GET /store/cart': ok(cartFixture()),
    'GET /store/wishlist': ok({ items: [] }),
    'GET /store/account/me': ok(null),
    'GET /store/builder/popups': (_init, url) => ok({ popups: typeof popups === 'function' ? popups(url) : popups, never_on: neverOn }),
    ...routes,
  })
  return { fetchMock, ...renderRoutes(storefrontRoutes, path) }
}

const popupRequests = (fetchMock: ReturnType<typeof mockApi>) =>
  fetchMock.mock.calls.map(([input]) => new URL(String(input), 'http://localhost')).filter((url) => url.pathname.endsWith('/store/builder/popups'))

describe('builder popups on the store', () => {
  it('opens a modal: named by its heading, focus moved in and kept there, Esc closes and restores focus', async () => {
    const user = userEvent.setup()
    renderStore([popupEntry(POPUP_A, { frequency: { kind: 'once_per_session', days: 7 } }, offerElements('a'))])
    expect(await screen.findByRole('heading', { name: 'About us' })).toBeInTheDocument()

    const dialog = await screen.findByRole('dialog', { name: 'Join our list' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAttribute('data-layout', 'modal')
    await waitFor(() => expect(dialog).toHaveFocus())
    expect(document.body.style.overflow).toBe('hidden')
    expect(screen.getByTestId('popup-overlay')).toHaveClass('bg-black/55')

    // Tab wraps inside the dialog (Shop now → Close → Shop now).
    const shop = within(dialog).getByRole('link', { name: 'Shop now' })
    const close = within(dialog).getByRole('button', { name: 'Close' })
    await user.tab()
    expect(shop).toHaveFocus()
    await user.tab()
    expect(close).toHaveFocus()
    await user.tab()
    expect(shop).toHaveFocus()
    await user.tab({ shift: true })
    expect(close).toHaveFocus()

    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(document.body.style.overflow).toBe('')
    expect(document.getElementById('main')).toHaveFocus()
    expect(JSON.parse(window.localStorage.getItem(`sf.popup.${POPUP_A}`)!)).toMatchObject({ closes: 1, acted: null })
  })

  it('loads popups after the page and shows a once-per-session popup only once', async () => {
    const user = userEvent.setup()
    const { fetchMock, router } = renderStore([popupEntry(POPUP_A, { frequency: { kind: 'once_per_session', days: 7 } }, offerElements('a'))])
    await user.click(within(await screen.findByRole('dialog', { name: 'Join our list' })).getByRole('button', { name: 'Close' }))
    expect(popupRequests(fetchMock)).toHaveLength(1)
    await act(() => router.navigate('/pages/faq'))
    expect(await screen.findByRole('heading', { name: 'FAQ' })).toBeInTheDocument()
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('shows an every-page-view popup again on the next page, but not after its dismiss button was used', async () => {
    const user = userEvent.setup()
    const elements = [elementNode('heading', 'e_h', { text: 'Free delivery today' }), elementNode('button', 'e_ok', { label: 'OK', link: { url: '/shop' }, action: 'dismiss' })]
    const { router } = renderStore([popupEntry(POPUP_A, { frequency: { kind: 'every_page_view', days: 7 }, stop_after_action: true }, elements)])
    await user.click(within(await screen.findByRole('dialog', { name: 'Free delivery today' })).getByRole('button', { name: 'Close' }))
    await act(() => router.navigate('/pages/faq'))
    const again = await screen.findByRole('dialog', { name: 'Free delivery today' })
    // The dismiss button is a button (not a link) and closes the popup for good.
    await user.click(within(again).getByRole('button', { name: 'OK' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(readPopupRecord(POPUP_A).acted).not.toBeNull()
    await act(() => router.navigate('/pages/about'))
    expect(await screen.findByRole('heading', { name: 'About us' })).toBeInTheDocument()
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('waits for its delay', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    renderStore([popupEntry(POPUP_A, { trigger: { kind: 'on_load', delay_seconds: 8, scroll_percent: 50 } }, offerElements('a'))])
    expect(await screen.findByRole('heading', { name: 'About us' })).toBeInTheDocument()
    await act(async () => void vi.advanceTimersByTime(5000))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await act(async () => void vi.advanceTimersByTime(3500))
    expect(await screen.findByRole('dialog', { name: 'Join our list' })).toBeInTheDocument()
  })

  it('shows one modal-like popup at a time (server order), the next after it closes; bars coexist, one per edge', async () => {
    const user = userEvent.setup()
    renderStore([
      popupEntry(POPUP_A, {}, offerElements('a', 'First offer')),
      popupEntry(POPUP_B, { layout: 'slide_in' }, offerElements('b', 'Second offer')),
      popupEntry(POPUP_C, { layout: 'bar_top' }, [elementNode('text', 'e_bar', { html: '<p>Free delivery over ৳1000</p>' })]),
      popupEntry(uuid(0xb8b0d), { layout: 'bar_top' }, [elementNode('text', 'e_bar2', { html: '<p>Second top bar</p>' })]),
    ])
    const first = await screen.findByRole('dialog', { name: 'First offer' })
    expect(screen.queryByRole('dialog', { name: 'Second offer' })).not.toBeInTheDocument()
    expect(await screen.findByRole('region', { name: 'Store notice' })).toHaveTextContent('Free delivery over ৳1000')
    expect(screen.queryByText('Second top bar')).not.toBeInTheDocument()

    await user.click(within(first).getByRole('button', { name: 'Close' }))
    const second = await screen.findByRole('dialog', { name: 'Second offer' })
    expect(second).toHaveAttribute('aria-modal', 'false')
  })

  it('draws a slide-in without taking focus and announces it politely', async () => {
    renderStore([popupEntry(POPUP_A, { layout: 'slide_in', position: 'bottom_left', width: 'sm' }, offerElements('a', 'Eid sale'))])
    const dialog = await screen.findByRole('dialog', { name: 'Eid sale' })
    expect(dialog).toHaveAttribute('aria-modal', 'false')
    expect(dialog).toHaveClass('left-4', 'max-w-sm')
    expect(dialog).not.toContainElement(document.activeElement as HTMLElement)
    expect(document.body.style.overflow).toBe('')
    await waitFor(() => expect(screen.getByTestId('popup-announcer')).toHaveTextContent('Eid sale'))
  })

  it('pads the page by a bar’s height and gives it back when it closes', async () => {
    const user = userEvent.setup()
    const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return { height: this.dataset.layout === 'bar_bottom' ? 52 : 0, width: 0, x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, toJSON: () => ({}) } as DOMRect
    })
    renderStore([popupEntry(POPUP_A, { layout: 'bar_bottom', label: 'Cookie notice' }, [elementNode('text', 'e_c', { html: '<p>We use only the cookies the shop needs.</p>' })])])
    const bar = await screen.findByRole('region', { name: 'Cookie notice' })
    expect(bar).toHaveClass('fixed', 'bottom-0')
    expect(document.body.style.paddingBottom).toBe('52px')
    expect(document.documentElement.style.getPropertyValue('--sf-popup-bar-bottom')).toBe('52px')
    await user.click(within(bar).getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Cookie notice' })).not.toBeInTheDocument())
    expect(document.body.style.paddingBottom).toBe('')
    rect.mockRestore()
  })

  it('closes on an overlay click only when allowed', async () => {
    const user = userEvent.setup()
    renderStore([popupEntry(POPUP_A, { close_on_overlay: false, overlay: false }, offerElements('a')), popupEntry(POPUP_B, {}, offerElements('b', 'Second'))])
    await screen.findByRole('dialog', { name: 'Join our list' })
    expect(screen.getByTestId('popup-overlay')).toHaveClass('bg-transparent')
    await user.click(screen.getByTestId('popup-overlay'))
    expect(screen.getByRole('dialog', { name: 'Join our list' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Close' }))
    await screen.findByRole('dialog', { name: 'Second' })
    await user.click(screen.getByTestId('popup-overlay'))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('uses the admin label as the name and closes when a link inside is followed', async () => {
    const user = userEvent.setup()
    renderStore([popupEntry(POPUP_A, { label: 'Weekly offer' }, offerElements('a'))], { routes: { 'GET /store/products': ok([]) } })
    const dialog = await screen.findByRole('dialog', { name: 'Weekly offer' })
    await user.click(within(dialog).getByRole('link', { name: 'Shop now' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(readPopupRecord(POPUP_A).acted).not.toBeNull()
  })

  it('never shows on cart or checkout pages, nor on paths the server rules out, and leaves when the visitor goes there', async () => {
    const { router } = renderStore([popupEntry(POPUP_A, { frequency: { kind: 'every_page_view', days: 7 } }, offerElements('a'))], { path: '/cart' })
    expect(await screen.findByRole('heading', { level: 1 })).toBeInTheDocument()
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await act(() => router.navigate('/pages/about'))
    expect(await screen.findByRole('dialog', { name: 'Join our list' })).toBeInTheDocument()
    await act(() => router.navigate('/cart'))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('respects the page, device and audience rules', async () => {
    stubMedia(['(max-width: 767.98px)'])
    renderStore(
      [
        popupEntry(POPUP_A, { devices: 'desktop' }, offerElements('a', 'Desktop only')),
        popupEntry(POPUP_B, { pages: { kind: 'home', paths: [] } }, offerElements('b', 'Home only')),
        popupEntry(POPUP_C, { audience: 'signed_in' }, offerElements('c', 'Members only')),
        popupEntry(uuid(0xb8b0d), { audience: 'guests', devices: 'mobile', layout: 'bar_top' }, [elementNode('heading', 'e_g', { text: 'Hello guest' })]),
      ],
      { routes: { 'GET /store/account/me': ok(null) } },
    )
    expect(await screen.findByRole('region', { name: 'Hello guest' })).toBeInTheDocument()
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('waits while another dialog is open', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const other = document.createElement('div')
    other.setAttribute('role', 'dialog')
    other.setAttribute('aria-modal', 'true')
    document.body.appendChild(other)
    renderStore([popupEntry(POPUP_A, {}, offerElements('a'))])
    expect(await screen.findByRole('heading', { name: 'About us' })).toBeInTheDocument()
    await act(async () => void vi.advanceTimersByTime(1500))
    expect(screen.queryByRole('dialog', { name: 'Join our list' })).not.toBeInTheDocument()
    other.remove()
    await act(async () => void vi.advanceTimersByTime(1500))
    expect(await screen.findByRole('dialog', { name: 'Join our list' })).toBeInTheDocument()
  })

  it('previews one popup’s draft at once for staff, whatever its rules, and remembers nothing', async () => {
    markPopupShown(POPUP_A)
    const { fetchMock } = renderStore(
      (url) => (url.searchParams.get('preview') === 'draft' && url.searchParams.get('popup') === POPUP_A ? [popupEntry(POPUP_A, { frequency: { kind: 'once_forever', days: 7 }, trigger: { kind: 'on_exit', delay_seconds: 120, scroll_percent: 50 }, devices: 'mobile' }, offerElements('a', 'Draft offer'), null)] : []),
      { path: `/pages/about?preview=draft&popup=${POPUP_A}` },
    )
    expect(await screen.findByRole('dialog', { name: 'Draft offer' })).toBeInTheDocument()
    expect(screen.getByTestId('popup-preview-note')).toHaveTextContent('Draft popup preview')
    expect(popupRequests(fetchMock)[0]!.searchParams.get('preview')).toBe('draft')
    const before = window.localStorage.getItem(`sf.popup.${POPUP_A}`)
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(window.localStorage.getItem(`sf.popup.${POPUP_A}`)).toBe(before)
  })
})

/* ---------------------------------------------------------------------------------------------
 * The form element
 * ------------------------------------------------------------------------------------------- */

const FIELDS: FormField[] = [
  { id: 'f_name', kind: 'text', label: 'Your name', placeholder: '', help: 'As on your ID card', required: true, options: [], min: null, max: null, max_length: 20, reply_to: false },
  { id: 'f_email', kind: 'email', label: 'E-mail', placeholder: 'you@example.com', help: '', required: true, options: [], min: null, max: null, max_length: null, reply_to: true },
  {
    id: 'f_topic',
    kind: 'select',
    label: 'Topic',
    placeholder: '',
    help: '',
    required: true,
    options: [
      { id: 'o_order', label: 'An order' },
      { id: 'o_other', label: 'Something else' },
    ],
    min: null,
    max: null,
    max_length: null,
    reply_to: false,
  },
  { id: 'f_qty', kind: 'number', label: 'Quantity', placeholder: '', help: '', required: false, options: [], min: 1, max: 50, max_length: null, reply_to: false },
  {
    id: 'f_days',
    kind: 'checkboxes',
    label: 'Delivery days',
    placeholder: '',
    help: '',
    required: false,
    options: [
      { id: 'd_fri', label: 'Friday' },
      { id: 'd_sat', label: 'Saturday' },
    ],
    min: null,
    max: null,
    max_length: null,
    reply_to: false,
  },
]

const formNode = (patch: Record<string, unknown> = {}) =>
  elementNode('form', 'e_form', { title: 'Ask us', fields: FIELDS, consent: { text: 'I agree to be contacted', link: { url: '/pages/privacy-policy' } }, ...patch })

function renderForm(routes: Routes = {}, { source = 'published' as 'published' | 'draft', patch = {} as Record<string, unknown> } = {}) {
  const builder: BuilderPage = payloadOf(documentOf([formNode(patch)]), { key: 'cms:about', source })
  return renderStore([], { routes: { 'GET /store/pages/about': ok({ ...classicPage('about'), builder }), ...routes } })
}

describe('form element values', () => {
  it('checks answers like the server and builds the request values', () => {
    const [name, email, topic, qty] = FIELDS as [FormField, FormField, FormField, FormField]
    expect(fieldError(name, '  ')).toEqual({ key: 'content.builder.form.errorRequired', params: { label: 'Your name' } })
    expect(fieldError(name, 'x'.repeat(21))).toEqual({ key: 'content.builder.form.errorLength', params: { max: 20 } })
    expect(fieldError(email, 'nope')).toEqual({ key: 'content.builder.form.errorEmail' })
    expect(fieldError(topic, 'o_unknown')?.key).toBe('content.builder.form.errorChoose')
    expect(fieldError(qty, '0')).toEqual({ key: 'content.builder.form.errorMin', params: { min: 1 } })
    expect(fieldError(qty, '1e3')).toEqual({ key: 'content.builder.form.errorNumber' })
    expect(fieldError(qty, '')).toBeNull()
    expect(fieldError({ ...name, kind: 'phone', max_length: null }, '+880 1711-000000')).toBeNull()
    expect(fieldError({ ...name, kind: 'phone', max_length: null }, 'call me')?.key).toBe('content.builder.form.errorPhone')
    expect(fieldError({ ...name, kind: 'date', max_length: null }, '2026-13-01')?.key).toBe('content.builder.form.errorDate')
    expect(submitValues(FIELDS, { ...initialValues(FIELDS), f_name: ' Rina ', f_email: 'rina@example.com', f_topic: 'o_order', f_qty: '3', f_days: ['d_sat'] })).toEqual({
      f_name: 'Rina',
      f_email: 'rina@example.com',
      f_topic: 'o_order',
      f_qty: 3,
      f_days: ['d_sat'],
    })
    expect(readFields([{ id: 'BAD', kind: 'text' }, { id: 'f_ok', kind: 'file', label: 'x' }, { id: 'f_a', kind: 'email', label: 'A', reply_to: true, max_length: 5 }])).toEqual([
      { id: 'f_a', kind: 'email', label: 'A', placeholder: '', help: '', required: false, options: [], min: null, max: null, max_length: null, reply_to: true },
    ])
  })
})

describe('form element', () => {
  it('labels every field, links help and errors, and moves focus to the error summary', async () => {
    const user = userEvent.setup()
    const { fetchMock } = renderForm()
    const form = await screen.findByRole('form', { name: 'Ask us' })
    const name = within(form).getByRole('textbox', { name: /Your name/ })
    expect(name).toHaveAttribute('aria-required', 'true')
    expect(name).toHaveAttribute('maxlength', '20')
    expect(name).toHaveAccessibleDescription('As on your ID card')
    expect(within(form).getByRole('combobox', { name: /Topic/ })).toBeInTheDocument()
    expect(within(form).getByRole('group', { name: 'Delivery days' })).toBeInTheDocument()
    expect(within(form).getByRole('link', { name: 'Read more' })).toHaveAttribute('target', '_blank')
    // Honeypot: out of sight, out of the tab order, never autofilled.
    const honeypot = form.querySelector<HTMLInputElement>('input[name="website"]')!
    expect(honeypot).toHaveAttribute('tabindex', '-1')
    expect(honeypot).toHaveAttribute('autocomplete', 'off')
    expect(honeypot.closest('[aria-hidden="true"]')).not.toBeNull()

    await user.type(within(form).getByRole('textbox', { name: /E-mail/ }), 'not-an-address')
    await user.click(within(form).getByRole('button', { name: 'Send' }))
    const summary = await screen.findByTestId('form-error-summary')
    await waitFor(() => expect(summary).toHaveFocus())
    expect(within(summary).getByRole('link', { name: /Your name: Please fill in “Your name”/ })).toBeInTheDocument()
    expect(within(summary).getByRole('link', { name: /E-mail: Please enter a valid e-mail address/ })).toBeInTheDocument()
    expect(within(summary).getByRole('link', { name: /I agree to be contacted: Please tick the box/ })).toBeInTheDocument()
    expect(name).toHaveAttribute('aria-invalid', 'true')
    expect(name).toHaveAccessibleDescription('As on your ID card Please fill in “Your name”.')
    await user.click(within(summary).getByRole('link', { name: /Your name:/ }))
    expect(name).toHaveFocus()
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/store/forms/'))).toBe(false)
  })

  it('sends the answers and shows the success message in a live region', async () => {
    const user = userEvent.setup()
    let body: unknown = null
    renderForm({
      'POST /store/forms/01a1c9d9-0000-7000-8000-0000000000d1/e_form': (init) => {
        body = JSON.parse(String(init.body))
        return { status: 202, body: { success: true, data: { message: 'Thanks, Rina!' }, meta: { request_id: 't' } } }
      },
    })
    const form = await screen.findByRole('form', { name: 'Ask us' })
    await user.type(within(form).getByRole('textbox', { name: /Your name/ }), 'Rina')
    await user.type(within(form).getByRole('textbox', { name: /E-mail/ }), 'rina@example.com')
    await user.selectOptions(within(form).getByRole('combobox', { name: /Topic/ }), 'o_other')
    await user.type(within(form).getByRole('spinbutton', { name: /Quantity/ }), '2')
    await user.click(within(form).getByRole('checkbox', { name: 'Saturday' }))
    await user.click(within(form).getByRole('checkbox', { name: /I agree to be contacted/ }))
    await user.click(within(form).getByRole('button', { name: 'Send' }))

    expect(await screen.findByText('Thanks, Rina!')).toBeInTheDocument()
    expect(screen.getByTestId('form-status')).toHaveAttribute('aria-live', 'polite')
    expect(body).toEqual({
      values: { f_name: 'Rina', f_email: 'rina@example.com', f_topic: 'o_other', f_qty: 2, f_days: ['d_sat'] },
      consent: true,
      website: '',
      page_path: '/pages/about',
    })
    await user.click(screen.getByRole('button', { name: 'Send another response' }))
    expect(await screen.findByRole('form', { name: 'Ask us' })).toBeInTheDocument()
  })

  it('shows the server’s field errors and friendly messages for other failures', async () => {
    const user = userEvent.setup()
    let reply = fail(422, 'VALIDATION_ERROR', 'Invalid', { 'values.f_email': ['This e-mail address is not accepted.'], 'values.f_extra': ['This field is not part of the form.'] })
    renderForm({ 'POST /store/forms/01a1c9d9-0000-7000-8000-0000000000d1/e_form': () => reply }, { patch: { consent: null, fields: FIELDS.slice(0, 2) } })
    const form = await screen.findByRole('form', { name: 'Ask us' })
    await user.type(within(form).getByRole('textbox', { name: /Your name/ }), 'Rina')
    await user.type(within(form).getByRole('textbox', { name: /E-mail/ }), 'rina@example.com')
    await user.click(within(form).getByRole('button', { name: 'Send' }))
    const summary = await screen.findByTestId('form-error-summary')
    expect(within(summary).getByRole('link', { name: 'E-mail: This e-mail address is not accepted.' })).toBeInTheDocument()
    expect(within(form).getByRole('textbox', { name: /E-mail/ })).toHaveAttribute('aria-invalid', 'true')

    reply = fail(404, 'FORM_NOT_FOUND')
    await user.click(within(form).getByRole('button', { name: 'Send' }))
    expect(await within(form).findByText('This form is no longer available. Please reload the page.')).toBeInTheDocument()
    reply = fail(429, 'TOO_MANY_REQUESTS')
    await user.click(within(form).getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(within(screen.getByTestId('form-error-summary')).queryByText('This form is no longer available. Please reload the page.')).not.toBeInTheDocument())
  })

  it('draws a draft form that cannot be sent', async () => {
    renderForm({}, { source: 'draft' })
    const form = await screen.findByRole('form', { name: 'Ask us' })
    expect(within(form).getByRole('button', { name: 'Send' })).toBeDisabled()
    expect(within(form).getByTestId('form-draft-note')).toHaveTextContent('Forms work on your live store.')
  })

  it('inside a popup, sending counts as the visitor’s action', async () => {
    const user = userEvent.setup()
    const fields = [FIELDS[1]!]
    renderStore([popupEntry(POPUP_A, { frequency: { kind: 'every_page_view', days: 7 }, stop_after_action: true }, [formNode({ fields, consent: null, title: 'Get 10% off' })])], {
      routes: { [`POST /store/forms/${POPUP_A}/e_form`]: { status: 202, body: { success: true, data: { message: 'Check your inbox' }, meta: { request_id: 't' } } } },
    })
    const dialog = await screen.findByRole('dialog', { name: 'Get 10% off' })
    await user.type(within(dialog).getByRole('textbox', { name: /E-mail/ }), 'rina@example.com')
    await user.click(within(dialog).getByRole('button', { name: 'Send' }))
    expect(await within(dialog).findByText('Check your inbox')).toBeInTheDocument()
    expect(readPopupRecord(POPUP_A).acted).not.toBeNull()
    expect(isPopupDue(POPUP_A, settings({ frequency: { kind: 'every_page_view', days: 7 }, stop_after_action: true }))).toBe(false)
  })
})
