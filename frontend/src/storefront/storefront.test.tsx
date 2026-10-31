import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { fail, mockApi, ok, renderRoutes } from '@/test/utils'
import { storefrontRoutes } from './routes'
import { bootstrapFixture, menuNode } from './test-fixtures'
import type { StorefrontBootstrap } from './types'

const logo = { id: 'logo-1', url: '/storage/media/o/logo.png', srcset: '/storage/media/o/logo-320.webp 320w, /storage/media/o/logo.png 400w', width: 400, height: 120, alt: null }

function serve(bootstrap: StorefrontBootstrap) {
  return mockApi({ 'GET /store/bootstrap': ok(bootstrap) })
}

afterEach(() => {
  document.getElementById('storefront-bootstrap')?.remove()
  document.documentElement.removeAttribute('style')
})

describe('storefront layout', () => {
  it('renders the store with header, navigation, footer and theme variables', async () => {
    serve(bootstrapFixture({ theme: { ...bootstrapFixture().theme, colors: { ...bootstrapFixture().theme.colors, accent: '#123456' } } }))
    renderRoutes(storefrontRoutes)

    expect(await screen.findByRole('heading', { level: 1, name: 'Berry Kids' })).toBeInTheDocument()
    expect(screen.getByText('Clothes and toys for little ones')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Berry Kids home' })).toHaveAttribute('href', '/')
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument()
    expect(document.documentElement.style.getPropertyValue('--sf-accent')).toBe('#123456')
    expect(screen.getByText(`© ${new Date().getFullYear()} Berry Kids`)).toBeInTheDocument()
  })

  it('uses the payload written into the page instead of fetching', async () => {
    const fetchMock = mockApi({})
    const script = document.createElement('script')
    script.id = 'storefront-bootstrap'
    script.type = 'application/json'
    script.textContent = JSON.stringify(bootstrapFixture({ store: { name: 'Inline Store', description: null } }))
    document.body.appendChild(script)

    renderRoutes(storefrontRoutes)

    expect(await screen.findByRole('heading', { level: 1, name: 'Inline Store' })).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('shows the logo with its renditions when the theme has one', async () => {
    serve(bootstrapFixture({ theme: { ...bootstrapFixture().theme, logo } }))
    renderRoutes(storefrontRoutes)

    const img = await screen.findByRole('img', { name: 'Berry Kids' })
    expect(img).toHaveAttribute('srcset', logo.srcset)
    expect(img).toHaveAttribute('width', '400')
  })

  it('opens a dropdown and a mega panel from their toggles and closes them with Escape', async () => {
    serve(bootstrapFixture())
    renderRoutes(storefrontRoutes)
    const user = userEvent.setup()
    const nav = await screen.findByRole('navigation', { name: 'Main' })

    const girls = within(nav).getByRole('button', { name: 'Girls submenu' })
    expect(girls).toHaveAttribute('aria-expanded', 'false')
    expect(within(nav).queryByRole('link', { name: 'Dresses' })).not.toBeInTheDocument()
    await user.click(girls)
    expect(girls).toHaveAttribute('aria-expanded', 'true')
    expect(within(nav).getByRole('link', { name: 'Dresses' })).toHaveAttribute('href', '/girls/dresses')
    await user.keyboard('{Escape}')
    expect(girls).toHaveAttribute('aria-expanded', 'false')
    expect(girls).toHaveFocus()

    await user.click(within(nav).getByRole('button', { name: 'Boys submenu' }))
    const mega = screen.getByTestId('mega-panel')
    expect(within(mega).getByRole('link', { name: 'Clothing' })).toBeInTheDocument()
    expect(within(mega).getByRole('link', { name: 'T-shirts' })).toHaveAttribute('href', '/boys/clothing/t-shirts')
    expect(within(mega).getAllByRole('list')[0]?.className).toContain('grid-cols-3')
    // Only one panel at a time.
    expect(within(nav).getByRole('button', { name: 'Girls submenu' })).toHaveAttribute('aria-expanded', 'false')

    const blog = within(nav).getByRole('link', { name: 'Blog' })
    expect(blog).toHaveAttribute('target', '_blank')
    expect(blog).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('mobile drawer uses the mobile menu, falling back to the main menu', async () => {
    serve(bootstrapFixture())
    const { unmount } = renderRoutes(storefrontRoutes)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Open menu' }))
    const drawer = await screen.findByRole('dialog')
    expect(within(drawer).getByRole('link', { name: 'Boys' })).toBeInTheDocument()
    await user.click(within(drawer).getByRole('button', { name: 'Boys submenu' }))
    expect(within(drawer).getByRole('link', { name: 'Clothing' })).toBeVisible()
    unmount()

    serve(bootstrapFixture({ menus: { ...bootstrapFixture().menus, mobile: { name: 'Mobile', items: [menuNode('Sale', '/sale')] } } }))
    renderRoutes(storefrontRoutes)
    await user.click(await screen.findByRole('button', { name: 'Open menu' }))
    const mobileDrawer = await screen.findByRole('dialog')
    expect(within(mobileDrawer).getByRole('link', { name: 'Sale' })).toBeInTheDocument()
    expect(within(mobileDrawer).queryByRole('link', { name: 'Boys' })).not.toBeInTheDocument()
  })

  it('renders the footer columns, contact, social links, payment logos and copyright', async () => {
    const base = bootstrapFixture()
    serve(
      bootstrapFixture({
        theme: {
          ...base.theme,
          footer: {
            about: 'Since 2020',
            copyright: '© Berry Kids Ltd.',
            contact: { email: 'hello@berry.test', phone: '+880 1711-000000', address: 'Dhanmondi, Dhaka' },
            social: { facebook: 'https://facebook.com/berry', x: 'https://x.com/berry' },
            payment_logos: [{ ...logo, id: 'pay-1', alt: 'bKash' }],
          },
        },
        menus: { ...base.menus, footer_1: { name: 'Help', items: [menuNode('Shipping', '/shipping')] }, footer_2: { name: 'Empty', items: [] } },
      }),
    )
    renderRoutes(storefrontRoutes)

    const footer = await screen.findByTestId('site-footer')
    expect(within(footer).getByRole('navigation', { name: 'Help' })).toBeInTheDocument()
    expect(within(footer).queryByRole('navigation', { name: 'Empty' })).not.toBeInTheDocument()
    expect(within(footer).getByRole('link', { name: 'hello@berry.test' })).toHaveAttribute('href', 'mailto:hello@berry.test')
    expect(within(footer).getByRole('link', { name: '+880 1711-000000' })).toHaveAttribute('href', 'tel:+8801711000000')
    expect(within(footer).getByRole('link', { name: /Facebook/ })).toHaveAttribute('rel', 'noopener noreferrer')
    expect(within(footer).getByRole('img', { name: 'bKash' })).toBeInTheDocument()
    expect(within(footer).getByText('© Berry Kids Ltd.')).toBeInTheDocument()
  })

  it('shows the announcement, the preview ribbon and the custom CSS as text', async () => {
    const base = bootstrapFixture()
    serve(
      bootstrapFixture({
        preview: true,
        theme: { ...base.theme, announcement: { text: 'Free delivery over ৳2000', link: '/shipping', background: '#000000', foreground: '#ffffff' }, custom_css: '.x{color:red}' },
      }),
    )
    renderRoutes(storefrontRoutes)

    expect(await screen.findByRole('link', { name: 'Free delivery over ৳2000' })).toHaveAttribute('href', '/shipping')
    expect(screen.getByRole('status')).toHaveTextContent('Preview — this store is not open to customers yet.')
    expect(screen.getByTestId('custom-css').textContent).toBe('.x{color:red}')
  })

  it('renders the not-found page for unknown paths', async () => {
    serve(bootstrapFixture())
    renderRoutes(storefrontRoutes, '/no-such-page')

    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to the home page' })).toHaveAttribute('href', '/')
  })

  it('explains when there is no open store at the address', async () => {
    mockApi({ 'GET /store/bootstrap': fail(404, 'STOREFRONT_NOT_FOUND', 'There is no open store at this address.') })
    renderRoutes(storefrontRoutes)

    expect(await screen.findByRole('heading', { name: 'There is no open store at this address' })).toBeInTheDocument()
  })

  it('offers a retry when the store cannot be loaded', async () => {
    let calls = 0
    mockApi({ 'GET /store/bootstrap': () => (++calls === 1 ? fail(500, 'SERVER_ERROR') : ok(bootstrapFixture())) })
    renderRoutes(storefrontRoutes)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'Berry Kids' })).toBeInTheDocument())
  })
})
