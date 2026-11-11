import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { routes } from '@/app/routes'
import type { MenuDetail, StorefrontDomain, ThemeResponse } from '@/features/storefront/api'
import { makeCurrentUser } from '@/test/fixtures'
import { mockApi, ok, renderRoutes } from '@/test/utils'

const manager = () => makeCurrentUser({ permissions: ['storefront.view', 'storefront.manage', 'media.manage'] })
const viewer = () => makeCurrentUser({ permissions: ['storefront.view'] })

const theme: ThemeResponse = {
  settings: {
    colors: { primary: '#f59e0b', primary_foreground: '#3b2500', accent: '#6f55c2', accent_foreground: '#ffffff', highlight: '#2fb79a', sale: '#c2410c', heading: '#3d3d3d', text: '#5f6368', canvas: '#f3f7fa', surface: '#ffffff', border: '#e1e1e1' },
    typography: { heading_font: 'baloo', body_font: 'poppins' },
    shape: { button_style: 'pill', card_radius: 12 },
    layout: { container_width: 1170, sticky_header: true, header_style: 'standard', footer_style: 'columns', card_style: 'standard', hero_style: 'full', heading_case: 'normal', top_bar: 'none' },
    preset: 'default',
    logo_media_id: null,
    favicon_media_id: null,
    announcement: { enabled: false, text: null, link: null, background: '#6f55c2', foreground: '#ffffff', starts_at: null, ends_at: null },
    footer: { about: null, copyright: null, contact: { email: null, phone: null, address: null }, social: { facebook: null, instagram: null, youtube: null, tiktok: null, x: null, linkedin: null }, payment_logo_media_ids: [] },
  },
  custom_css: null,
  has_custom_css: false,
  updated_at: null,
}

const emptyMedia = ok([], { pagination: { current_page: 1, per_page: 100, total: 0, last_page: 1 } })

describe('online store admin', () => {
  it('adds a domain and opens the store', async () => {
    const user = userEvent.setup()
    let domains: StorefrontDomain[] = []
    let added: unknown
    let patched: unknown
    mockApi({
      'GET /auth/me': ok(manager()),
      'GET /storefront/settings': ok({ is_enabled: false, site_name: 'Berry Kids', meta_description: null, updated_at: null }),
      'GET /storefront/domains': () => ok(domains),
      'POST /storefront/domains': (init) => {
        added = JSON.parse(String(init.body))
        domains = [{ id: 'd-1', host: 'shop.example.com', is_primary: true, created_at: null }]
        return { status: 201, ...ok(domains[0]) }
      },
      'PATCH /storefront/settings': (init) => {
        patched = JSON.parse(String(init.body))
        return ok({ is_enabled: true, site_name: 'Berry Kids', meta_description: null, updated_at: null })
      },
    })
    renderRoutes(routes, '/storefront')

    expect(await screen.findByText('Closed')).toBeInTheDocument()
    await user.type(screen.getByLabelText('New domain'), ' shop.example.com ')
    await user.click(screen.getByRole('button', { name: 'Add domain' }))
    await waitFor(() => expect(added).toEqual({ host: 'shop.example.com' }))
    expect(await screen.findByRole('cell', { name: 'shop.example.com' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /https:\/\/shop\.example\.com/ })).toHaveAttribute('href', 'https://shop.example.com')

    await user.click(screen.getByRole('switch', { name: 'Store open to customers' }))
    await waitFor(() => expect(patched).toEqual({ is_enabled: true }))
    expect(await screen.findByText('Open')).toBeInTheDocument()
  })

  it('saves the whole theme document', async () => {
    const user = userEvent.setup()
    let saved: unknown
    mockApi({
      'GET /auth/me': ok(manager()),
      'GET /storefront/theme': ok(theme),
      'GET /media': emptyMedia,
      'PUT /storefront/theme': (init) => {
        saved = JSON.parse(String(init.body))
        return ok({ ...theme, settings: saved })
      },
    })
    renderRoutes(routes, '/storefront/theme')

    const primary = await screen.findByLabelText('Primary')
    await user.clear(primary)
    await user.type(primary, '#a35a00')
    await user.type(screen.getByLabelText('Copyright line'), '© Berry Kids')
    await user.click(screen.getByRole('button', { name: 'Save theme' }))

    await waitFor(() =>
      expect(saved).toEqual({
        ...theme.settings,
        colors: { ...theme.settings.colors, primary: '#a35a00' },
        footer: { ...theme.settings.footer, copyright: '© Berry Kids' },
      }),
    )
    // The contrast check reflects the edited colour.
    const checks = screen.getByRole('list', { name: 'Contrast checks' })
    expect(within(checks).getAllByText('AA pass').length).toBeGreaterThan(0)
  })

  it('is read-only without storefront.manage', async () => {
    mockApi({
      'GET /auth/me': ok(viewer()),
      'GET /storefront/theme': ok(theme),
      'GET /storefront/menus': ok([{ id: 'm-1', name: 'Main', location: 'main', location_label: 'Main navigation', is_active: true, updated_at: null }]),
      'GET /storefront/menus/m-1': ok({ id: 'm-1', name: 'Main', location: 'main', location_label: 'Main navigation', is_active: true, updated_at: null, items: [{ id: 'i-1', type: 'custom', label: 'Boys', url: '/boys', open_in_new_tab: false, is_visible: true, is_mega: false, mega_columns: null, image_media_id: null, children: [] }] }),
    })
    const { router } = renderRoutes(routes, '/storefront/theme')

    expect(await screen.findByLabelText('Primary')).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Save theme' })).not.toBeInTheDocument()
    expect(screen.queryByText('Custom CSS')).not.toBeInTheDocument()

    await router.navigate('/storefront/menus')
    expect(await screen.findByLabelText('Item 1 label')).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Add item' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save items' })).not.toBeInTheDocument()
  })

  it('builds a menu tree and saves it', async () => {
    const user = userEvent.setup()
    const menu: MenuDetail = { id: 'm-1', name: 'Main', location: 'main', location_label: 'Main navigation', is_active: true, updated_at: null, items: [] }
    let saved: unknown
    mockApi({
      'GET /auth/me': ok(manager()),
      'GET /storefront/menus': ok([menu]),
      'GET /storefront/menus/m-1': ok(menu),
      'PUT /storefront/menus/m-1/items': (init) => {
        saved = JSON.parse(String(init.body))
        return ok({ ...menu, items: (saved as { items: MenuDetail['items'] }).items })
      },
    })
    renderRoutes(routes, '/storefront/menus')

    await user.click(await screen.findByRole('button', { name: 'Add item' }))
    await user.type(screen.getByLabelText('Item 1 label'), 'Boys')
    expect(screen.getByLabelText('Item 1 Bangla label')).toHaveAttribute('lang', 'bn')
    await user.type(screen.getByLabelText('Item 1 Bangla label'), 'ছেলেদের')
    await user.type(screen.getByLabelText('Item 1 link'), '/boys')
    await user.click(screen.getByRole('button', { name: 'Add child to Item 1' }))
    await user.type(screen.getByLabelText('Item 1.1 label'), 'Shirts')
    await user.type(screen.getByLabelText('Item 1.1 link'), 'javascript:alert(1)')
    await user.click(screen.getByRole('button', { name: 'Save items' }))

    // Invalid link is caught before anything is sent.
    expect(await screen.findByText('Use a site path such as /sale or an http(s) URL.')).toBeInTheDocument()
    expect(saved).toBeUndefined()

    await user.clear(screen.getByLabelText('Item 1.1 link'))
    await user.type(screen.getByLabelText('Item 1.1 link'), '/boys/shirts')
    await user.click(screen.getByRole('switch', { name: 'Mega menu' }))
    await user.click(screen.getByRole('button', { name: 'Save items' }))

    await waitFor(() =>
      expect(saved).toEqual({
        items: [
          {
            type: 'custom', label: 'Boys', url: '/boys', target_id: null, open_in_new_tab: false, is_visible: true, is_mega: true, mega_columns: 4, image_media_id: null,
            translations: { bn: { label: 'ছেলেদের' } },
            children: [{ type: 'custom', label: 'Shirts', url: '/boys/shirts', target_id: null, open_in_new_tab: false, is_visible: true, is_mega: false, mega_columns: null, image_media_id: null, children: [] }],
          },
        ],
      }),
    )
  })
})
