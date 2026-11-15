import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import type { ThemeSettings } from '@/features/storefront/api'
import { renderWithQuery } from '@/test/utils'
import { SiteStylesDrawer } from './site-styles'
import type { SiteStyles } from './use-site-styles'

/* P1b: the product page layout in the builder's Site styles drawer (theme draft, like the colours). */

const settings = {
  colors: { primary: '#f59e0b', primary_foreground: '#3b2500', accent: '#6f55c2', accent_foreground: '#ffffff', highlight: '#2fb79a', sale: '#c2410c', heading: '#3d3d3d', text: '#5f6368', canvas: '#f3f7fa', surface: '#ffffff', border: '#e1e1e1' },
  typography: { heading_font: 'baloo', body_font: 'poppins' },
  shape: { button_style: 'pill', card_radius: 12 },
  layout: { container_width: 1170, sticky_header: true, listing_columns: { desktop: 4, tablet: 3, mobile: 2 }, product: { gallery: 'left', thumbnails: 'bottom', sticky_summary: false, details: 'tabs' } },
  logo_media_id: null,
  favicon_media_id: null,
  announcement: { enabled: false, text: null, link: null, background: '#000000', foreground: '#ffffff', starts_at: null, ends_at: null },
  footer: { about: null, copyright: null, contact: { email: null, phone: null, address: null }, social: {}, payment_logo_media_ids: [] },
} as unknown as ThemeSettings

function styles(over: Partial<SiteStyles> = {}): SiteStyles {
  return {
    settings,
    draft: { settings, draft_revision: 2, has_unpublished_changes: false, published: { number: 3, published_at: null } } as unknown as SiteStyles['draft'],
    loading: false,
    loadError: false,
    status: 'idle',
    message: null,
    errors: {},
    change: vi.fn(),
    flush: vi.fn(async () => true),
    publish: vi.fn(async () => true),
    publishing: false,
    schedule: null,
    scheduleLater: vi.fn(async () => true),
    cancelSchedule: vi.fn(async () => true),
    ...over,
  }
}

function open(value: SiteStyles) {
  renderWithQuery(
    <MemoryRouter>
      <SiteStylesDrawer open onOpenChange={() => {}} styles={value} canPublish />
    </MemoryRouter>,
  )
  return screen.getByTestId('site-styles-drawer')
}

describe('Site styles drawer: product page layout (P1b)', () => {
  it('changes the photos side and the details style in the theme draft, keeping the other layout keys', async () => {
    const user = userEvent.setup()
    const value = styles()
    const drawer = open(value)
    const group = within(drawer).getByTestId('site-styles-product-layout')
    expect(within(group).getByRole('heading', { name: 'Product page' })).toBeInTheDocument()
    expect(within(group).getByRole('radio', { name: /Photos on the left/ })).toBeChecked()

    await user.click(within(group).getByRole('radio', { name: /Photos on the right/ }))
    expect(value.change).toHaveBeenLastCalledWith(
      expect.objectContaining({ layout: { container_width: 1170, sticky_header: true, listing_columns: { desktop: 4, tablet: 3, mobile: 2 }, product: { gallery: 'right', thumbnails: 'bottom', sticky_summary: false, details: 'tabs' } } }),
    )
    await user.click(within(group).getByRole('switch', { name: 'Keep the price and Add to cart in view' }))
    expect(value.change).toHaveBeenLastCalledWith(expect.objectContaining({ layout: expect.objectContaining({ product: expect.objectContaining({ sticky_summary: true }) }) }))
    await user.click(within(group).getByRole('radio', { name: /Fold-out sections/ }))
    expect(value.change).toHaveBeenLastCalledWith(expect.objectContaining({ layout: expect.objectContaining({ product: expect.objectContaining({ details: 'accordion' }) }) }))
    expect(within(drawer).getByText(/the product page layout for the whole store/)).toBeInTheDocument()
  })

  it('shows the server’s message on the product layout field it belongs to', () => {
    const drawer = open(styles({ errors: { 'layout.product.details': 'Choose tabs, fold-out sections or one after another.' }, status: 'error', message: 'Some values aren’t allowed; fix the marked fields.' }))
    expect(within(within(drawer).getByTestId('site-styles-product-layout')).getByText('Choose tabs, fold-out sections or one after another.')).toBeInTheDocument()
  })

  it('B11: Publish site styles asks now or later; later sends the store-time instant', async () => {
    const user = userEvent.setup()
    const value = styles({ draft: { settings, draft_revision: 2, has_unpublished_changes: true, published: { number: 3, published_at: null } } as unknown as SiteStyles['draft'] })
    const drawer = open(value)
    await user.click(within(drawer).getByRole('button', { name: 'Publish site styles' }))
    const dialog = await screen.findByRole('dialog', { name: 'Publish the site styles?' })
    await user.click(within(dialog).getByRole('radio', { name: /Publish later/ }))
    await user.click(within(dialog).getByRole('button', { name: 'Schedule' }))
    expect(value.scheduleLater).toHaveBeenCalledWith(expect.stringMatching(/T09:00:00[+-]\d\d:\d\d$/), null)
    expect(value.publish).not.toHaveBeenCalled()
  })

  it('B11: a planned publish shows as a chip with its time', () => {
    const drawer = open(styles({ schedule: { id: 's-1', status: 'pending', publish_at: '2026-12-01T03:00:00Z', note: null, created_by: null } }))
    expect(within(drawer).getByTestId('schedule-chip')).toHaveTextContent('Goes live')
  })
})
