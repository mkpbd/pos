import { useState } from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { routes } from '@/app/routes'
import type { ThemeDocument, ThemeDraft } from '@/features/storefront/api'
import { makeCurrentUser } from '@/test/fixtures'
import { fail, mockApi, ok, renderRoutes } from '@/test/utils'
import { DEFAULT_PRODUCT_LAYOUT, type ProductLayout } from './product-layout'
import { ProductLayoutFields } from './product-layout-card'

vi.mock('sonner', async (importOriginal) => {
  const original = await importOriginal<typeof import('sonner')>()
  return { ...original, toast: Object.assign(vi.fn(), { ...original.toast, error: vi.fn(), success: vi.fn() }) }
})

function Harness({ initial = DEFAULT_PRODUCT_LAYOUT, onChange, disabled, variant }: { initial?: ProductLayout; onChange?: (next: ProductLayout) => void; disabled?: boolean; variant?: 'page' | 'drawer' }) {
  const [value, setValue] = useState(initial)
  return (
    <ProductLayoutFields
      value={value}
      disabled={disabled}
      variant={variant}
      onChange={(next) => {
        setValue(next)
        onChange?.(next)
      }}
    />
  )
}

describe('ProductLayoutFields', () => {
  it('shows today’s look as the standard choices and changes one key at a time', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)

    const card = screen.getByRole('region', { name: 'Product page' })
    expect(within(card).getByRole('radio', { name: 'Photos on the left' })).toBeChecked()
    expect(within(card).getByRole('radio', { name: 'Photos on the left' })).toHaveAccessibleDescription('Standard')
    expect(within(card).getByRole('radio', { name: 'Under the main photo' })).toBeChecked()
    expect(within(card).getByRole('radio', { name: 'Tabs' })).toBeChecked()
    expect(within(card).getByRole('switch', { name: 'Keep the price and Add to cart in view' })).not.toBeChecked()
    expect(within(card).getByRole('group', { name: 'Small photos' })).toHaveAccessibleDescription('Phones always show them under the photo.')
    expect(within(card).queryByRole('button', { name: 'Use the standard layout' })).not.toBeInTheDocument()
    expect(within(card).getByRole('img', { name: /^Product page: photos on the left, small photos under the main photo/ })).toBeInTheDocument()

    await user.click(within(card).getByRole('radio', { name: 'Photos on the right' }))
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_PRODUCT_LAYOUT, gallery: 'right' })
    await user.click(within(card).getByRole('radio', { name: 'Beside the main photo' }))
    await user.click(within(card).getByRole('switch', { name: 'Keep the price and Add to cart in view' }))
    await user.click(within(card).getByRole('radio', { name: 'Fold-out sections' }))
    expect(onChange).toHaveBeenLastCalledWith({ gallery: 'right', thumbnails: 'side', sticky_summary: true, details: 'accordion' })
    expect(within(card).getByRole('img', { name: 'Product page: photos on the right, small photos beside the main photo, price and Add to cart stay in view while scrolling, details in fold-out sections.' })).toBeInTheDocument()

    // Arrow keys move within a group (native radios).
    within(card).getByRole('radio', { name: 'Fold-out sections' }).focus()
    await user.keyboard('{ArrowRight}')
    expect(within(card).getByRole('radio', { name: 'One after another' })).toBeChecked()

    await user.click(within(card).getByRole('button', { name: 'Use the standard layout' }))
    expect(onChange).toHaveBeenLastCalledWith(DEFAULT_PRODUCT_LAYOUT)
    expect(within(card).getByRole('radio', { name: 'Photos on the left' })).toBeChecked()
  })

  it('is read-only when disabled and fits the Site styles drawer', () => {
    render(<Harness initial={{ gallery: 'right', thumbnails: 'side', sticky_summary: true, details: 'stacked' }} disabled variant="drawer" />)

    const section = screen.getByRole('region', { name: 'Product page' })
    expect(within(section).getByRole('heading', { name: 'Product page' })).toBeInTheDocument()
    for (const radio of within(section).getAllByRole('radio')) expect(radio).toBeDisabled()
    expect(within(section).getByRole('radio', { name: 'One after another' })).toBeChecked()
    expect(within(section).getByRole('switch')).toBeDisabled()
    expect(within(section).queryByRole('button', { name: 'Use the standard layout' })).not.toBeInTheDocument()
  })
})

const manager = () => makeCurrentUser({ permissions: ['storefront.view', 'storefront.manage', 'storefront.publish', 'media.manage'] })

const columns = { desktop: 5, tablet: 4, mobile: 1 }
const baseLayout = { container_width: 1170, sticky_header: true, header_style: 'standard', footer_style: 'columns', card_style: 'standard', hero_style: 'full', heading_case: 'normal', top_bar: 'none' } as const

const settings = (layout: Record<string, unknown>): ThemeDocument => ({
  colors: { primary: '#f59e0b', primary_foreground: '#3b2500', accent: '#6f55c2', accent_foreground: '#ffffff', highlight: '#2fb79a', sale: '#c2410c', heading: '#3d3d3d', text: '#5f6368', canvas: '#f3f7fa', surface: '#ffffff', border: '#e1e1e1' },
  typography: { heading_font: 'baloo', body_font: 'poppins' },
  shape: { button_style: 'pill', card_radius: 12 },
  layout: { ...baseLayout, ...layout } as ThemeDocument['layout'],
  preset: 'default',
  logo_media_id: null,
  favicon_media_id: null,
  announcement: { enabled: false, text: null, link: null, background: '#6f55c2', foreground: '#ffffff', starts_at: null, ends_at: null },
  footer: { about: null, copyright: null, contact: { email: null, phone: null, address: null }, social: { facebook: null, instagram: null, youtube: null, tiktok: null, x: null, linkedin: null }, payment_logo_media_ids: [] },
})

const draftOf = (doc: ThemeDocument): ThemeDraft => ({ settings: doc, draft_revision: 3, has_unpublished_changes: false, published: { version_id: 'v-1', number: 1, published_at: null }, custom_css: null, has_custom_css: false })

function themeApi(doc: ThemeDocument, put?: (settings: ThemeDocument) => ReturnType<typeof ok>) {
  const saved: ThemeDocument[] = []
  mockApi({
    'GET /auth/me': ok(manager()),
    'GET /notifications/unread-count': ok({ count: 0 }),
    'GET /storefront/theme/draft': ok(draftOf(doc)),
    'GET /storefront/theme/presets': ok([]),
    'GET /media': ok([], { pagination: { current_page: 1, per_page: 100, total: 0, last_page: 1 } }),
    'PUT /storefront/theme/draft': (init) => {
      const body = JSON.parse(String(init.body)) as { settings: ThemeDocument }
      saved.push(body.settings)
      return put ? put(body.settings) : ok({ ...draftOf(body.settings), draft_revision: 4, has_unpublished_changes: true })
    },
  })
  return saved
}

describe('Theme page → Product page layout', () => {
  it('saves the product layout with the draft and keeps the listing columns (regression)', async () => {
    const user = userEvent.setup()
    const saved = themeApi(settings({ listing_columns: columns, product: DEFAULT_PRODUCT_LAYOUT }))
    renderRoutes(routes, '/storefront/theme')

    const card = await screen.findByRole('region', { name: 'Product page' })
    await user.click(within(card).getByRole('radio', { name: 'Photos on the right' }))
    await user.click(within(card).getByRole('radio', { name: 'Beside the main photo' }))
    await user.click(within(card).getByRole('switch', { name: 'Keep the price and Add to cart in view' }))
    await user.click(within(card).getByRole('radio', { name: 'Fold-out sections' }))
    expect(screen.getByTestId('theme-status')).toHaveTextContent('Unsaved changes')
    await user.click(screen.getByRole('button', { name: 'Save draft' }))

    await waitFor(() => expect(saved).toHaveLength(1))
    expect(saved[0]?.layout).toEqual({ ...baseLayout, listing_columns: columns, product: { gallery: 'right', thumbnails: 'side', sticky_summary: true, details: 'accordion' } })
  })

  it('keeps listing_columns and layout.product when something else is saved', async () => {
    const user = userEvent.setup()
    const product = { gallery: 'right', thumbnails: 'side', sticky_summary: true, details: 'stacked' } as const
    const saved = themeApi(settings({ listing_columns: columns, product }))
    renderRoutes(routes, '/storefront/theme')

    await user.click(await screen.findByRole('combobox', { name: 'Section headings' }))
    await user.click(await screen.findByRole('option', { name: 'UPPERCASE' }))
    await user.click(screen.getByRole('button', { name: 'Save draft' }))

    await waitFor(() => expect(saved).toHaveLength(1))
    expect(saved[0]?.layout).toEqual({ ...baseLayout, heading_case: 'uppercase', listing_columns: columns, product })
  })

  it('shows the server’s message on the right choice', async () => {
    const user = userEvent.setup()
    themeApi(settings({ product: DEFAULT_PRODUCT_LAYOUT }), () => fail(422, 'VALIDATION_FAILED', 'Invalid.', { 'settings.layout.product.details': ['The selected details is invalid.'] }))
    renderRoutes(routes, '/storefront/theme')

    const card = await screen.findByRole('region', { name: 'Product page' })
    await user.click(within(card).getByRole('radio', { name: 'One after another' }))
    await user.click(screen.getByRole('button', { name: 'Save draft' }))
    expect(await within(card).findByText('The selected details is invalid.')).toBeInTheDocument()
    expect(within(card).getByRole('group', { name: 'Description, specifications and reviews' })).toHaveAccessibleDescription('The selected details is invalid.')
  })

  it('has no product layout card while the API does not send layout.product', async () => {
    const saved = themeApi(settings({ listing_columns: columns }))
    renderRoutes(routes, '/storefront/theme')

    expect(await screen.findByRole('combobox', { name: 'Section headings' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Product page' })).not.toBeInTheDocument()
    expect(saved).toHaveLength(0)
  })
})
