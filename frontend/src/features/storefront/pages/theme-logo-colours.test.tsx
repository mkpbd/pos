import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { routes } from '@/app/routes'
import type { ThemeDocument, ThemeDraft } from '@/features/storefront/api'
import { LogoColoursStep } from '@/features/storefront/theme/logo-colours'
import { makeCurrentUser } from '@/test/fixtures'
import { mockApi, ok, renderRoutes } from '@/test/utils'

/* B21 "Get colours from my logo" on the Theme page (and the wizard's step): proposals, preview, saved to the draft only. */

const toasts = vi.hoisted(() => ({ info: vi.fn(), error: vi.fn(), success: vi.fn() }))
vi.mock('sonner', async (importOriginal) => {
  const original = await importOriginal<typeof import('sonner')>()
  return { ...original, toast: Object.assign(vi.fn(), { ...original.toast, ...toasts }) }
})
const pixels = vi.hoisted(() => vi.fn())
vi.mock('@/features/storefront/theme/logo-palette', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/features/storefront/theme/logo-palette')>()), readLogoPixels: pixels }))

const LOGO = '0190a1c9-0000-7000-8000-00000000c0de'

const settings: ThemeDocument = {
  colors: { primary: '#f59e0b', primary_foreground: '#3b2500', accent: '#6f55c2', accent_foreground: '#ffffff', highlight: '#2fb79a', sale: '#c2410c', heading: '#3d3d3d', text: '#5f6368', canvas: '#f3f7fa', surface: '#ffffff', border: '#e1e1e1', button: '#f59e0b', button_foreground: '#3b2500', button_hover: null, link: '#6f55c2' },
  typography: { heading_font: 'baloo', body_font: 'poppins', body_size: 16, heading_scale: 1.25, line_height: 1.5, heading_weight: 700, mobile_scale: 1, letter_spacing: 0 },
  palette: [],
  shape: { button_style: 'pill', card_radius: 12 },
  layout: { container_width: 1170, sticky_header: true, header_style: 'standard', footer_style: 'columns', card_style: 'standard', hero_style: 'full', heading_case: 'normal', top_bar: 'none' },
  preset: 'default',
  logo_media_id: LOGO,
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
  preview_url: null,
  custom_css: null,
  has_custom_css: false,
  ...overrides,
})

const logoItem = { id: LOGO, url: '/storage/media/logo.png', srcset: '', width: 200, height: 100, alt: null, original_name: 'logo.png', mime_type: 'image/png', size: 1000, created_at: null }
const media = (_init: RequestInit, url: URL) =>
  ok((url.searchParams.get('ids') ?? '').includes(LOGO) ? [logoItem] : [], { pagination: { current_page: 1, per_page: 100, total: 1, last_page: 1 } })

/** An orange and navy logo on white. */
function logoPixels(): Uint8ClampedArray {
  const out: number[] = []
  const add = (px: number[], n: number) => {
    for (let i = 0; i < n; i += 1) out.push(...px)
  }
  add([255, 255, 255, 255], 300)
  add([234, 88, 12, 255], 500)
  add([30, 58, 138, 255], 250)
  return new Uint8ClampedArray(out)
}

type Put = { revision: number; settings: ThemeDocument }

function serve(puts: Put[]) {
  let current = draft()
  return mockApi({
    'GET /auth/me': ok(makeCurrentUser({ permissions: ['storefront.view', 'storefront.manage', 'storefront.publish', 'media.manage'] })),
    'GET /storefront/theme/presets': ok([]),
    'GET /media': media,
    'GET /storefront/theme/draft': () => ok(current),
    'PUT /storefront/theme/draft': (init) => {
      const put = JSON.parse(String(init.body)) as Put
      puts.push(put)
      current = draft({ settings: put.settings, draft_revision: put.revision + 1, has_unpublished_changes: true })
      return ok(current)
    },
  })
}

beforeEach(() => {
  Object.values(toasts).forEach((fn) => fn.mockReset())
  pixels.mockReset()
  pixels.mockResolvedValue(logoPixels())
})

describe('theme page: colours from the logo (B21)', () => {
  it('proposes palettes with a preview; Use these colours saves them to the draft (not published); Undo puts the old ones back', async () => {
    const user = userEvent.setup()
    const puts: Put[] = []
    serve(puts)
    renderRoutes(routes, '/storefront/theme')
    const card = await screen.findByTestId('logo-colours-card')
    expect(await within(card).findByText('Your store’s logo')).toBeInTheDocument()

    await user.click(within(card).getByRole('button', { name: 'Get colours from my logo' }))
    expect(pixels).toHaveBeenCalledWith('/storage/media/logo.png')
    const group = await within(card).findByRole('group', { name: /Colours from your logo/ })
    const radios = within(group).getAllByRole('radio')
    expect(radios).toHaveLength(3)
    expect(within(group).getByRole('radio', { name: /Your logo’s colours/ })).toBeChecked()
    expect(within(card).getByTestId('logo-proposal-logo')).toHaveTextContent('Add to cart')
    expect(within(card).getAllByText('Easy to read (WCAG AA)')).toHaveLength(3)

    await user.click(within(group).getByRole('radio', { name: /Swapped/ }))
    await user.click(within(card).getByRole('button', { name: 'Use these colours' }))
    await waitFor(() => expect(puts).toHaveLength(1))
    expect(puts[0]!.revision).toBe(5)
    expect(puts[0]!.settings.colors).toMatchObject({ primary: '#1e3a8a', primary_foreground: '#ffffff', button: '#1e3a8a', accent: '#ea580c' })
    // Everything else stays.
    expect(puts[0]!.settings.footer).toEqual(settings.footer)
    expect(await screen.findByTestId('theme-status')).toHaveTextContent('Draft — not live yet')

    // The toast's Undo saves the previous colours again (on the new revision).
    const [message, options] = toasts.success.mock.calls.at(-1) as [string, { action: { label: string; onClick: () => void } }]
    expect(message).toMatch(/in your theme draft\. Publish to show them/)
    expect(options.action.label).toBe('Undo')
    options.action.onClick()
    await waitFor(() => expect(puts).toHaveLength(2))
    expect(puts[1]!.revision).toBe(6)
    expect(puts[1]!.settings.colors).toMatchObject({ primary: '#f59e0b', button: '#f59e0b' })
  })

  it('a logo with no colour, or one that can’t be read, gets a plain message', async () => {
    const user = userEvent.setup()
    serve([])
    renderRoutes(routes, '/storefront/theme')
    const card = await screen.findByTestId('logo-colours-card')
    await within(card).findByText('Your store’s logo')
    pixels.mockResolvedValueOnce(new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255]))
    await user.click(within(card).getByRole('button', { name: 'Get colours from my logo' }))
    expect(await within(card).findByRole('alert')).toHaveTextContent('only black, white or see-through')
    pixels.mockRejectedValueOnce(new DOMException('Tainted', 'SecurityError'))
    await user.click(within(card).getByRole('button', { name: 'Get colours from my logo' }))
    expect(await within(card).findByRole('alert')).toHaveTextContent('couldn’t read the colours')
  })
})

describe('LogoColoursStep (the wizard’s optional step)', () => {
  it('saves the chosen colours straight to the theme draft', async () => {
    const user = userEvent.setup()
    const puts: Put[] = []
    serve(puts)
    const onDone = vi.fn()
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <LogoColoursStep onDone={onDone} />
      </QueryClientProvider>,
    )
    await screen.findByText('Your store’s logo')
    await user.click(screen.getByRole('button', { name: 'Get colours from my logo' }))
    await user.click(await screen.findByRole('button', { name: 'Use these colours' }))
    await waitFor(() => expect(puts).toHaveLength(1))
    expect(puts[0]).toMatchObject({ revision: 5, settings: { colors: { primary: '#ea580c', button_hover: null }, logo_media_id: LOGO } })
    expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ primary: '#ea580c' }))
  })
})
