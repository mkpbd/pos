import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { routes } from '@/app/routes'
import type { ThemeDocument, ThemeDraft, ThemePreset } from '@/features/storefront/api'
import { makeCurrentUser } from '@/test/fixtures'
import { fail, mockApi, ok, renderRoutes } from '@/test/utils'

const manager = () => makeCurrentUser({ permissions: ['storefront.view', 'storefront.manage', 'media.manage'] })
const viewer = () => makeCurrentUser({ permissions: ['storefront.view'] })

const settings: ThemeDocument = {
  colors: { primary: '#f59e0b', primary_foreground: '#3b2500', accent: '#6f55c2', accent_foreground: '#ffffff', highlight: '#2fb79a', sale: '#c2410c', heading: '#3d3d3d', text: '#5f6368', canvas: '#f3f7fa', surface: '#ffffff', border: '#e1e1e1' },
  typography: { heading_font: 'baloo', body_font: 'poppins' },
  shape: { button_style: 'pill', card_radius: 12 },
  layout: { container_width: 1170, sticky_header: true, header_style: 'standard', footer_style: 'columns', card_style: 'standard', hero_style: 'full', heading_case: 'normal', top_bar: 'none' },
  preset: 'default',
  logo_media_id: 'logo-1',
  favicon_media_id: null,
  announcement: { enabled: true, text: 'Free delivery over ৳2000', link: null, background: '#6f55c2', foreground: '#ffffff', starts_at: null, ends_at: null },
  footer: { about: 'Since 2020', copyright: null, contact: { email: null, phone: null, address: null }, social: { facebook: null, instagram: null, youtube: null, tiktok: null, x: null, linkedin: null }, payment_logo_media_ids: [] },
}

const theme: ThemeDraft = { settings, draft_revision: 2, has_unpublished_changes: false, published: { version_id: 'v-1', number: 1, published_at: null }, custom_css: null, has_custom_css: false }

const handmadeLook: ThemePreset['theme'] = {
  preset: 'handmade',
  colors: { primary: '#9c4a2a', primary_foreground: '#ffffff', accent: '#3b2a20', accent_foreground: '#ffffff', highlight: '#5f7a4f', sale: '#9c2f1f', heading: '#2b1d14', text: '#5a4a3f', canvas: '#f7f2ea', surface: '#fffdf9', border: '#e6dccd' },
  typography: { heading_font: 'playfair', body_font: 'jost' },
  shape: { button_style: 'square', card_radius: 0 },
  layout: { container_width: 1240, sticky_header: false, header_style: 'centered', footer_style: 'showcase', card_style: 'minimal', hero_style: 'tiles', heading_case: 'normal', top_bar: 'utility' },
}

const presets: ThemePreset[] = [
  { key: 'default', name: 'Default', description: 'The original look.', theme: { preset: 'default', colors: settings.colors, typography: settings.typography, shape: settings.shape, layout: settings.layout } },
  { key: 'vegan', name: 'Vegan Store', description: 'Fresh and organic.', theme: { ...handmadeLook, preset: 'vegan', typography: { heading_font: 'baloo', body_font: 'poppins' } } },
  { key: 'handmade', name: 'Handmade', description: 'Premium and artisan.', theme: handmadeLook },
  { key: 'classic', name: 'Classic Shop', description: 'Traditional and dense.', theme: { ...handmadeLook, preset: 'classic', typography: { heading_font: 'jost', body_font: 'jost' } } },
]

const emptyMedia = ok([], { pagination: { current_page: 1, per_page: 100, total: 0, last_page: 1 } })

describe('theme presets', () => {
  it('applies a preset to the draft after confirmation and refreshes the theme form', async () => {
    const user = userEvent.setup()
    let applied: string | null = null
    mockApi({
      'GET /auth/me': ok(manager()),
      'GET /storefront/theme/draft': ok(theme),
      'GET /storefront/theme/presets': ok(presets),
      'GET /media': emptyMedia,
      'POST /storefront/theme/presets/handmade/apply': () => {
        applied = 'handmade'
        return ok({ ...theme, draft_revision: 3, has_unpublished_changes: true, settings: { ...settings, ...handmadeLook, layout: handmadeLook.layout } })
      },
    })
    renderRoutes(routes, '/storefront/theme')

    const group = await screen.findByRole('radiogroup', { name: 'Theme presets' })
    expect(within(group).getAllByRole('radio')).toHaveLength(4)
    expect(within(group).getByRole('radio', { name: 'Default' })).toBeChecked()
    expect(within(screen.getByTestId('preset-default')).getByText('Current')).toBeInTheDocument()
    expect(within(group).getByRole('radio', { name: 'Handmade' })).toHaveAccessibleDescription('Premium and artisan.')
    expect(screen.getByRole('link', { name: /View store/ })).toHaveAttribute('href', '/?preview=1')

    await user.click(within(group).getByRole('radio', { name: 'Handmade' }))
    await user.click(screen.getByRole('button', { name: 'Apply preset' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Apply the Handmade preset?' })
    expect(dialog).toHaveTextContent('Replaces colours, fonts and layout in your draft; keeps your logo, announcement and footer text')
    expect(dialog).toHaveTextContent('Applies to your draft — publish to go live.')
    await user.click(within(dialog).getByRole('button', { name: 'Apply preset' }))

    await waitFor(() => expect(applied).toBe('handmade'))
    // The form shows the applied theme: colours, fonts and layout.
    expect(await screen.findByRole('button', { name: /^Primary: #9c4a2a/ })).toBeInTheDocument()
    // Not live: the draft waits for a publish.
    expect(screen.getByTestId('theme-status')).toHaveTextContent('Draft — not live yet')
    expect(screen.getByRole('combobox', { name: 'Header' })).toHaveTextContent('Centered brand, search icon')
    expect(screen.getByRole('combobox', { name: 'Footer' })).toHaveTextContent('Brand & product showcase')
    expect(screen.getByText('Playfair Display (serif, elegant)', { selector: '[data-slot="select-value"] *' })).toBeInTheDocument()
    expect(within(screen.getByTestId('preset-handmade')).getByText('Current')).toBeInTheDocument()
  })

  it('cancelling the confirmation applies nothing; a failed apply is shown', async () => {
    const user = userEvent.setup()
    const fetchMock = mockApi({
      'GET /auth/me': ok(manager()),
      'GET /storefront/theme/draft': ok(theme),
      'GET /storefront/theme/presets': ok(presets),
      'GET /media': emptyMedia,
      'POST /storefront/theme/presets/classic/apply': fail(404, 'NOT_FOUND', 'Unknown preset.'),
    })
    renderRoutes(routes, '/storefront/theme')

    await user.click(await screen.findByRole('radio', { name: 'Classic Shop' }))
    await user.click(screen.getByRole('button', { name: 'Apply preset' }))
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Cancel' }))
    expect(fetchMock.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === 'POST')).toBe(false)

    await user.click(screen.getByRole('button', { name: 'Apply preset' }))
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Apply preset' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Unknown preset.')
    expect(screen.getByRole('button', { name: /^Primary: #f59e0b/ })).toBeInTheDocument()
  })

  it('saving the draft keeps the preset and every layout variant', async () => {
    const user = userEvent.setup()
    let saved: ThemeDocument | undefined
    const handmade: ThemeDraft = { ...theme, settings: { ...settings, ...handmadeLook, layout: handmadeLook.layout } }
    mockApi({
      'GET /auth/me': ok(manager()),
      'GET /storefront/theme/draft': ok(handmade),
      'GET /storefront/theme/presets': ok(presets),
      'GET /media': emptyMedia,
      'PUT /storefront/theme/draft': (init) => {
        saved = (JSON.parse(String(init.body)) as { settings: ThemeDocument }).settings
        return ok({ ...handmade, settings: saved })
      },
    })
    renderRoutes(routes, '/storefront/theme')

    const header = await screen.findByRole('combobox', { name: 'Hero slider' })
    expect(header).toHaveTextContent('Up to three editorial tiles')
    await user.click(screen.getByRole('combobox', { name: 'Section headings' }))
    await user.click(await screen.findByRole('option', { name: 'UPPERCASE' }))
    await user.click(screen.getByRole('button', { name: 'Save draft' }))

    await waitFor(() => expect(saved).toBeDefined())
    expect(saved?.preset).toBe('handmade')
    expect(saved?.typography).toMatchObject({ heading_font: 'playfair', body_font: 'jost' })
    expect(saved?.layout).toEqual({ ...handmadeLook.layout, heading_case: 'uppercase' })
  })

  it('shows the presets read-only without storefront.manage', async () => {
    mockApi({
      'GET /auth/me': ok(viewer()),
      'GET /storefront/theme/draft': ok(theme),
      'GET /storefront/theme/presets': ok(presets),
    })
    renderRoutes(routes, '/storefront/theme')

    expect(await screen.findByRole('radio', { name: 'Vegan Store' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Apply preset' })).not.toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Product cards' })).toBeDisabled()
  })
})
