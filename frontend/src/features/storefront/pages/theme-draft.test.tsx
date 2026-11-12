import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { routes } from '@/app/routes'
import type { ThemeDocument, ThemeDraft, ThemeVersion } from '@/features/storefront/api'
import { makeCurrentUser } from '@/test/fixtures'
import { fail, mockApi, ok, renderRoutes } from '@/test/utils'

const publisher = () => makeCurrentUser({ permissions: ['storefront.view', 'storefront.manage', 'storefront.publish', 'media.manage'] })
const editor = () => makeCurrentUser({ permissions: ['storefront.view', 'storefront.manage', 'media.manage'] })

const settings: ThemeDocument = {
  colors: { primary: '#f59e0b', primary_foreground: '#3b2500', accent: '#6f55c2', accent_foreground: '#ffffff', highlight: '#2fb79a', sale: '#c2410c', heading: '#3d3d3d', text: '#5f6368', canvas: '#f3f7fa', surface: '#ffffff', border: '#e1e1e1', button: '#f59e0b', button_foreground: '#3b2500', button_hover: null, link: '#6f55c2' },
  typography: { heading_font: 'baloo', body_font: 'poppins', body_size: 16, heading_scale: 1.25, line_height: 1.5, heading_weight: 700, mobile_scale: 1, letter_spacing: 0 },
  palette: [],
  shape: { button_style: 'pill', card_radius: 12 },
  layout: { container_width: 1170, sticky_header: true, header_style: 'standard', footer_style: 'columns', card_style: 'standard', hero_style: 'full', heading_case: 'normal', top_bar: 'none' },
  preset: 'default',
  logo_media_id: null,
  favicon_media_id: null,
  announcement: { enabled: false, text: null, link: null, background: '#6f55c2', foreground: '#ffffff', starts_at: null, ends_at: null },
  footer: { about: null, copyright: null, contact: { email: null, phone: null, address: null }, social: { facebook: null, instagram: null, youtube: null, tiktok: null, x: null, linkedin: null }, payment_logo_media_ids: [] },
}

const draft = (overrides: Partial<ThemeDraft> = {}): ThemeDraft => ({
  settings,
  draft_revision: 5,
  has_unpublished_changes: false,
  draft_updated_at: null,
  published: { version_id: 'v-2', number: 2, published_at: '2026-11-10T10:00:00Z' },
  preview_url: 'https://shop.berry.test/?preview=draft',
  custom_css: null,
  has_custom_css: false,
  ...overrides,
})

const versions: ThemeVersion[] = [
  { id: 'v-2', number: 2, note: 'Eid colours', published_at: '2026-11-10T10:00:00Z', created_by: { id: 'u-1', name: 'Nadia' }, created_at: null },
  { id: 'v-1', number: 1, note: null, published_at: '2026-11-01T10:00:00Z', created_by: null, created_at: null },
]

const emptyMedia = ok([], { pagination: { current_page: 1, per_page: 100, total: 0, last_page: 1 } })
const body = (init: RequestInit) => JSON.parse(String(init.body ?? '{}')) as Record<string, unknown>

function serve(routes: Parameters<typeof mockApi>[0], user = publisher()) {
  return mockApi({ 'GET /auth/me': ok(user), 'GET /storefront/theme/presets': ok([]), 'GET /media': emptyMedia, ...routes })
}

async function changeCopyright(user: ReturnType<typeof userEvent.setup>, text: string) {
  const input = await screen.findByLabelText('Copyright line')
  await user.clear(input)
  await user.type(input, text)
}

afterEach(() => vi.restoreAllMocks())

describe('theme page: draft and publish', () => {
  it('saves the draft with its revision; the store is not changed until publish', async () => {
    const user = userEvent.setup()
    const puts: Record<string, unknown>[] = []
    const fetchMock = serve({
      'GET /storefront/theme/draft': ok(draft()),
      'PUT /storefront/theme/draft': (init) => {
        puts.push(body(init))
        return ok(draft({ settings: (body(init) as { settings: ThemeDocument }).settings, draft_revision: 6, has_unpublished_changes: true }))
      },
    })
    renderRoutes(routes, '/storefront/theme')

    expect(await screen.findByTestId('theme-status')).toHaveTextContent('Live')
    expect(screen.getByRole('button', { name: 'Save draft' })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Publish/ })).toBeDisabled()
    await changeCopyright(user, '© Berry Kids')
    expect(screen.getByTestId('theme-status')).toHaveTextContent('Unsaved changes')
    await user.click(screen.getByRole('button', { name: 'Save draft' }))

    await waitFor(() => expect(puts).toHaveLength(1))
    expect(puts[0]).toMatchObject({ revision: 5, settings: { footer: { copyright: '© Berry Kids' } } })
    expect(await screen.findByText('Draft saved — not published yet')).toBeInTheDocument()
    expect(screen.getByTestId('theme-status')).toHaveTextContent('Draft — not live yet')
    // Only the draft endpoint is written; the legacy live save is never used.
    expect(fetchMock.mock.calls.some(([url, init]) => String(url).endsWith('/storefront/theme') && (init as RequestInit)?.method === 'PUT')).toBe(false)
  })

  it('a stale save asks: keep mine saves over theirs with the new revision', async () => {
    const user = userEvent.setup()
    const puts: Record<string, unknown>[] = []
    let gets = 0
    serve({
      'GET /storefront/theme/draft': () => {
        gets++
        return ok(draft({ draft_revision: gets === 1 ? 5 : 9, has_unpublished_changes: gets > 1 }))
      },
      'PUT /storefront/theme/draft': (init) => {
        puts.push(body(init))
        return puts.length === 1 ? fail(409, 'DRAFT_CONFLICT', 'Stale', { revision: 9 }) : ok(draft({ settings: (body(init) as { settings: ThemeDocument }).settings, draft_revision: 10, has_unpublished_changes: true }))
      },
    })
    renderRoutes(routes, '/storefront/theme')

    await changeCopyright(user, 'Mine')
    await user.click(screen.getByRole('button', { name: 'Save draft' }))
    const dialog = await screen.findByRole('alertdialog', { name: /changed in another tab/ })
    await user.click(within(dialog).getByRole('button', { name: 'Keep mine' }))

    await waitFor(() => expect(puts).toHaveLength(2))
    expect(puts[1]).toMatchObject({ revision: 9, settings: { footer: { copyright: 'Mine' } } })
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(screen.getByLabelText('Copyright line')).toHaveValue('Mine')
  })

  it('a stale save asks: load their version replaces my edits', async () => {
    const user = userEvent.setup()
    let gets = 0
    serve({
      'GET /storefront/theme/draft': () => {
        gets++
        return ok(gets === 1 ? draft() : draft({ draft_revision: 9, has_unpublished_changes: true, settings: { ...settings, footer: { ...settings.footer, copyright: 'Theirs' } } }))
      },
      'PUT /storefront/theme/draft': fail(409, 'DRAFT_CONFLICT', 'Stale', { revision: 9 }),
    })
    renderRoutes(routes, '/storefront/theme')

    await changeCopyright(user, 'Mine')
    await user.click(screen.getByRole('button', { name: 'Save draft' }))
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Load their version' }))
    await waitFor(() => expect(screen.getByLabelText('Copyright line')).toHaveValue('Theirs'))
    expect(screen.getByRole('button', { name: 'Save draft' })).toBeDisabled()
  })

  it('maps validation errors of the draft onto the fields', async () => {
    const user = userEvent.setup()
    serve({
      'GET /storefront/theme/draft': ok(draft()),
      'PUT /storefront/theme/draft': fail(422, 'VALIDATION_FAILED', 'Invalid', { 'settings.footer.copyright': ['The copyright is not allowed.'] }),
    })
    renderRoutes(routes, '/storefront/theme')

    await changeCopyright(user, 'Bad')
    await user.click(screen.getByRole('button', { name: 'Save draft' }))
    expect(await screen.findByText('The copyright is not allowed.')).toBeInTheDocument()
  })

  it('publishes with a note, saving unsaved changes first', async () => {
    const user = userEvent.setup()
    const calls: string[] = []
    let published: Record<string, unknown> | undefined
    serve({
      'GET /storefront/theme/draft': ok(draft()),
      'PUT /storefront/theme/draft': (init) => {
        calls.push('save')
        return ok(draft({ settings: (body(init) as { settings: ThemeDocument }).settings, draft_revision: 6, has_unpublished_changes: true }))
      },
      'POST /storefront/theme/publish': (init) => {
        calls.push('publish')
        published = body(init)
        return ok(draft({ draft_revision: 6, has_unpublished_changes: false, published: { version_id: 'v-3', number: 3, published_at: '2026-11-12T10:00:00Z' } }))
      },
    })
    renderRoutes(routes, '/storefront/theme')

    await changeCopyright(user, '© 2026')
    await user.click(screen.getByRole('button', { name: /Publish/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Publish the theme?' })
    expect(dialog).toHaveTextContent('Your unsaved changes are saved first.')
    await user.type(within(dialog).getByLabelText('Note (optional)'), 'New footer')
    await user.click(within(dialog).getByRole('button', { name: 'Publish' }))

    await waitFor(() => expect(calls).toEqual(['save', 'publish']))
    expect(published).toEqual({ note: 'New footer' })
    await waitFor(() => expect(screen.getByTestId('theme-status')).toHaveTextContent('Live: version 3.'))
    expect(screen.getByTestId('theme-status')).toHaveTextContent('Your store shows this theme.')
  })

  it('without storefront.publish the draft can be saved but not published', async () => {
    serve({ 'GET /storefront/theme/draft': ok(draft({ has_unpublished_changes: true })) }, editor())
    renderRoutes(routes, '/storefront/theme')

    expect(await screen.findByRole('button', { name: 'Save draft' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Publish/ })).not.toBeInTheDocument()
  })

  it('discards the draft back to the live theme after a confirmation', async () => {
    const user = userEvent.setup()
    let discarded = false
    serve({
      'GET /storefront/theme/draft': ok(draft({ has_unpublished_changes: true, settings: { ...settings, footer: { ...settings.footer, copyright: 'Draft text' } } })),
      'POST /storefront/theme/discard': () => {
        discarded = true
        return ok(draft())
      },
    })
    renderRoutes(routes, '/storefront/theme')

    expect(await screen.findByLabelText('Copyright line')).toHaveValue('Draft text')
    await user.click(screen.getByRole('button', { name: 'Discard' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Discard the draft?' })
    await user.click(within(dialog).getByRole('button', { name: 'Discard' }))
    await waitFor(() => expect(discarded).toBe(true))
    await waitFor(() => expect(screen.getByLabelText('Copyright line')).toHaveValue(''))
    expect(screen.getByTestId('theme-status')).toHaveTextContent('Live')
  })

  it('restores a published version into the draft from the history', async () => {
    const user = userEvent.setup()
    let restored = ''
    serve({
      'GET /storefront/theme/draft': ok(draft()),
      'GET /storefront/theme/versions': ok(versions),
      'POST /storefront/theme/versions/v-1/restore': () => {
        restored = 'v-1'
        return ok(draft({ draft_revision: 6, has_unpublished_changes: true, settings: { ...settings, colors: { ...settings.colors, primary: '#0f766e', button: '#0f766e' } } }))
      },
    })
    renderRoutes(routes, '/storefront/theme')

    await user.click(await screen.findByRole('button', { name: /History/ }))
    const history = await screen.findByRole('dialog', { name: /Theme history/ })
    const live = await within(history).findByTestId('theme-version-2')
    expect(live).toHaveTextContent('Live')
    expect(live).toHaveTextContent('Eid colours')
    await user.click(within(history).getByRole('button', { name: 'Restore version 1 to the draft' }))
    await user.click(within(await screen.findByRole('alertdialog', { name: /Restore version 1/ })).getByRole('button', { name: 'Restore' }))

    await waitFor(() => expect(restored).toBe('v-1'))
    expect(await screen.findByRole('button', { name: /^Primary: #0f766e/ })).toBeInTheDocument()
    expect(screen.getByTestId('theme-status')).toHaveTextContent('Draft — not live yet')
  })

  it('previews the saved draft on the store (saving unsaved edits first)', async () => {
    const user = userEvent.setup()
    const tab = { location: { href: '' }, close: vi.fn() }
    const open = vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window)
    let saved = false
    serve({
      'GET /storefront/theme/draft': ok(draft()),
      'PUT /storefront/theme/draft': (init) => {
        saved = true
        return ok(draft({ settings: (body(init) as { settings: ThemeDocument }).settings, draft_revision: 6, has_unpublished_changes: true }))
      },
    })
    renderRoutes(routes, '/storefront/theme')

    await changeCopyright(user, 'Preview me')
    await user.click(screen.getByRole('button', { name: /Preview/ }))
    await waitFor(() => expect(tab.location.href).toBe('https://shop.berry.test/?preview=draft'))
    expect(saved).toBe(true)
    expect(open).toHaveBeenCalledTimes(1)
  })

  it('asks before leaving with unsaved changes', async () => {
    const user = userEvent.setup()
    serve({ 'GET /storefront/theme/draft': ok(draft()), 'GET /storefront/menus': ok([]) })
    const { router } = renderRoutes(routes, '/storefront/theme')

    await changeCopyright(user, 'Unsaved')
    void router.navigate('/storefront/menus')
    const dialog = await screen.findByRole('alertdialog', { name: 'Leave without saving?' })
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(router.state.location.pathname).toBe('/storefront/theme')
    void router.navigate('/storefront/menus')
    await user.click(within(await screen.findByRole('alertdialog', { name: 'Leave without saving?' })).getByRole('button', { name: 'Leave anyway' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/storefront/menus'))
  })

  it('custom CSS still saves straight to the live store', async () => {
    const user = userEvent.setup()
    let css: unknown
    serve(
      {
        'GET /storefront/theme/draft': ok(draft()),
        'PUT /storefront/theme/custom-css': (init) => {
          css = body(init)
          return ok({ settings, custom_css: '.x{}', has_custom_css: true, updated_at: null })
        },
      },
      makeCurrentUser({ permissions: ['storefront.view', 'storefront.manage', 'storefront.publish', 'storefront.custom_css', 'media.manage'] }),
    )
    renderRoutes(routes, '/storefront/theme')

    expect(await screen.findByText(/Saved straight to your live store — not part of the draft/)).toBeInTheDocument()
    await user.type(screen.getByLabelText('CSS'), '.x{{}')
    await user.click(screen.getByRole('button', { name: 'Save CSS' }))
    await waitFor(() => expect(css).toEqual({ custom_css: '.x{}' }))
  })
})
