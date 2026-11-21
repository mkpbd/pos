import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { routes } from '@/app/routes'
import type { ThemeDocument, ThemeDraft } from '@/features/storefront/api'
import { toDocument, toFormValues } from '@/features/storefront/theme-form'
import { makeCurrentUser } from '@/test/fixtures'
import { mockApi, ok, renderRoutes } from '@/test/utils'

/*
 * B20 Theme → Add to cart: the animation (Fly to cart / Bump the cart / None) with a preview and the
 * Button feedback switch, saved with the draft as the optional `effects` group (sent once set or
 * changed; a theme without it keeps it absent).
 */

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
  preview_url: null,
  custom_css: null,
  has_custom_css: false,
  ...overrides,
})

const emptyMedia = ok([], { pagination: { current_page: 1, per_page: 100, total: 0, last_page: 1 } })
const body = (init: RequestInit) => JSON.parse(String(init.body ?? '{}')) as { revision: number; settings: ThemeDocument }

function serve(theme: ThemeDocument, puts: ThemeDocument[]) {
  return mockApi({
    'GET /auth/me': ok(makeCurrentUser({ permissions: ['storefront.view', 'storefront.manage', 'storefront.publish', 'media.manage'] })),
    'GET /storefront/theme/presets': ok([]),
    'GET /media': emptyMedia,
    'GET /storefront/theme/draft': ok(draft({ settings: theme })),
    'PUT /storefront/theme/draft': (init) => {
      puts.push(body(init).settings)
      return ok(draft({ settings: body(init).settings, draft_revision: 6, has_unpublished_changes: true }))
    },
  })
}

afterEach(() => vi.restoreAllMocks())

describe('theme form model: effects', () => {
  it('reads absent / invalid effects as the defaults and sends them only once set or changed', () => {
    const values = toFormValues(settings)
    expect(values.effects).toEqual({ add_to_cart: 'bump', button_feedback: true })
    expect('effects' in toDocument(values, undefined, settings)).toBe(false)
    expect(toDocument({ ...values, effects: { add_to_cart: 'fly', button_feedback: true } }, undefined, settings).effects).toEqual({ add_to_cart: 'fly', button_feedback: true })
    const stored = { ...settings, effects: { add_to_cart: 'none', button_feedback: false } } as ThemeDocument
    expect(toFormValues(stored).effects).toEqual({ add_to_cart: 'none', button_feedback: false })
    // A theme that has the group keeps sending it, even back at the defaults.
    expect(toDocument({ ...values }, undefined, stored).effects).toEqual({ add_to_cart: 'bump', button_feedback: true })
    expect(toFormValues({ ...settings, effects: { add_to_cart: 'zoom', button_feedback: 'yes' } } as unknown as ThemeDocument).effects).toEqual({ add_to_cart: 'bump', button_feedback: true })
    expect(toFormValues({ ...settings, effects: null }).effects).toEqual({ add_to_cart: 'bump', button_feedback: true })
  })
})

describe('theme page: Add to cart', () => {
  it('chooses Fly to cart and turns button feedback off; saved with the draft', async () => {
    const user = userEvent.setup()
    const puts: ThemeDocument[] = []
    serve(settings, puts)
    renderRoutes(routes, '/storefront/theme')

    const card = await screen.findByTestId('cart-effects-card')
    const group = within(card).getByRole('radiogroup', { name: 'Add to cart animation' })
    expect(within(group).getByRole('radio', { name: 'Bump the cart' })).toHaveAttribute('aria-checked', 'true')
    expect(within(card).getByTestId('add-to-cart-hint')).toHaveTextContent('Only the cart count bumps.')
    expect(within(card).getByTestId('cart-effect-preview')).toHaveAttribute('aria-hidden', 'true')

    await user.click(within(group).getByRole('radio', { name: 'Fly to cart' }))
    expect(within(card).getByTestId('add-to-cart-hint')).toHaveTextContent('flies into the cart')
    // The preview plays: the cart count goes up and the button says "Added" (button feedback on).
    expect(within(card).getByTestId('cart-effect-count')).toHaveTextContent('3')
    expect(within(card).getByTestId('cart-effect-added')).not.toHaveClass('invisible')

    await user.click(within(card).getByRole('switch', { name: 'Button feedback' }))
    await user.click(within(card).getByRole('button', { name: 'Play preview' }))
    expect(within(card).getByTestId('cart-effect-added')).toHaveClass('invisible')

    await user.click(screen.getByRole('button', { name: 'Save draft' }))
    await waitFor(() => expect(puts).toHaveLength(1))
    expect(puts[0]!.effects).toEqual({ add_to_cart: 'fly', button_feedback: false })
  })

  it('the arrow keys move between the choices; an untouched theme saves without the group', async () => {
    const user = userEvent.setup()
    const puts: ThemeDocument[] = []
    serve(settings, puts)
    renderRoutes(routes, '/storefront/theme')

    const card = await screen.findByTestId('cart-effects-card')
    within(card).getByRole('radio', { name: 'Bump the cart' }).focus()
    await user.keyboard('{ArrowRight}')
    expect(within(card).getByRole('radio', { name: 'None' })).toHaveAttribute('aria-checked', 'true')
    await user.keyboard('{ArrowLeft}')
    expect(within(card).getByRole('radio', { name: 'Bump the cart' })).toHaveAttribute('aria-checked', 'true')

    const input = screen.getByLabelText('Copyright line')
    await user.type(input, '© Berry')
    await user.click(screen.getByRole('button', { name: 'Save draft' }))
    await waitFor(() => expect(puts).toHaveLength(1))
    expect('effects' in puts[0]!).toBe(false)
  })
})
