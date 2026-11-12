import { useState } from 'react'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { ELEMENT_REGISTRY } from '@/storefront/builder/registry'
import type { Column, Element, Section } from '@/storefront/builder/types'
import { makeCurrentUser } from '@/test/fixtures'
import { mockApi, ok, renderWithQuery } from '@/test/utils'
import { buildElement } from './create-element'
import { createElement, Inspector, type BuilderContent, type BuilderNode, type ElementsMetadata, type InspectorProps } from './index'
import { validateNode } from './validate'

/*
 * B4 inspector forms: video, icon, countdown, discount, call to action, search box, promoted
 * product, header / footer parts, newsletter form, FAQ list, contact form and custom HTML (with
 * its permission), plus the setup dialog of elements that need content first.
 */

const registry: ElementsMetadata = { types: [...ELEMENT_REGISTRY], limits: {}, enums: {} }
const common = { style: {}, visibility: { desktop: true, tablet: true, mobile: true }, hidden: false, schedule: null, translations: {} }
const UUID = '0b6f2e3c-1a2b-4c3d-8e9f-0123456789ab'
const UUID2 = '1b6f2e3c-1a2b-4c3d-8e9f-0123456789ab'
const UUID3 = '2b6f2e3c-1a2b-4c3d-8e9f-0123456789ab'
const pagination = (total: number) => ({ pagination: { current_page: 1, per_page: 100, total, last_page: 1 } })

/** A node of the type with the registry defaults and the given props. */
const node = (type: string, props: Record<string, unknown> = {}) => {
  const base = buildElement(type, registry, new Set())!
  return { ...base, id: 'e_test01', props: { ...base.props, ...props } } as unknown as Element
}

function contentWith(element: Element): BuilderContent {
  const column: Column = { id: 'c_col001', type: 'column', width: { base: 100 }, style: {}, elements: [element] }
  return { schema_version: 1, sections: [{ id: 's_sec001', type: 'section', props: { layout: 'boxed', anchor: null }, ...common, columns: [column] } as Section] }
}

function setup(initial: Element, options: { locales?: string[]; kind?: InspectorProps['document']['kind']; key?: string; canCustomHtml?: boolean } = {}) {
  const onChange = vi.fn()
  function Harness() {
    const [current, setCurrent] = useState<BuilderNode>(initial)
    return (
      <Inspector
        content={contentWith(current as Element)}
        node={current}
        document={{ id: 'd-1', kind: options.kind ?? 'page', key: options.key ?? 'home', title: 'Home', path: '/', published: null }}
        registry={registry}
        locales={options.locales ?? ['en']}
        errors={[]}
        canCustomHtml={options.canCustomHtml}
        onChange={(next, opts) => {
          onChange(next, opts)
          setCurrent(next)
        }}
        onCommand={vi.fn()}
      />
    )
  }
  const user = userEvent.setup()
  renderWithQuery(
    <MemoryRouter>
      <Harness />
    </MemoryRouter>,
  )
  return { user, onChange, last: () => onChange.mock.calls.at(-1)?.[0] as Element & { props: Record<string, unknown> } }
}

const promotion = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  id, name, type: 'percent', value: '10.00', scope: 'order', trigger: 'coupon', starts_at: null, ends_at: null, is_active: true, state: 'active',
  coupon_count: 1, redemption_count: 0, discount_total: '0.00', show_countdown: false, ...extra,
})

function mockStore(extra: Parameters<typeof mockApi>[0] = {}) {
  return mockApi({
    'GET /auth/me': ok(makeCurrentUser()),
    'GET /storefront/link-targets': ok({ pages: [{ id: 'p-1', slug: 'about-us', title: 'About us', status: 'published' }], categories: [], brands: [], blog_categories: [], blog_posts: [] }),
    'GET /storefront/theme': ok({ settings: { colors: { primary: '#0f766e' } }, custom_css: null, has_custom_css: false, updated_at: null }),
    ...extra,
  })
}

describe('B4 forms: media and marketing', () => {
  it('video: detects the provider from the link, stores its id and requires a title', async () => {
    mockStore()
    const { user, last } = setup(node('video', { title: 'Our farm' }))
    expect(screen.getByText(/Paste the link of a YouTube or Vimeo video/)).toBeInTheDocument()

    const link = screen.getByLabelText('Video link')
    await user.type(link, 'https://example.com/clip')
    expect(await screen.findByText(/Use a YouTube link/)).toBeInTheDocument()
    expect(last().props).toMatchObject({ video_id: '' })

    await user.clear(link)
    await user.type(link, 'https://youtu.be/dQw4w9WgXcQ')
    expect(screen.getByTestId('video-detected')).toHaveTextContent('YouTube video found (dQw4w9WgXcQ)')
    expect(last().props).toMatchObject({ url: 'https://youtu.be/dQw4w9WgXcQ', provider: 'youtube', video_id: 'dQw4w9WgXcQ' })

    await user.clear(link)
    await user.type(link, 'https://vimeo.com/76979871')
    expect(last().props).toMatchObject({ provider: 'vimeo', video_id: '76979871' })

    await user.clear(screen.getByLabelText('Video title'))
    expect(await screen.findByText(/Describe the video in a few words/)).toBeInTheDocument()

    await user.click(screen.getByRole('combobox', { name: 'Shape' }))
    await user.click(await screen.findByRole('option', { name: 'Tall, for Shorts (9:16)' }))
    await user.click(screen.getByRole('switch', { name: 'Play without sound' }))
    const start = screen.getByLabelText('Start at (seconds)')
    await user.clear(start)
    await user.type(start, '90')
    expect(last().props).toMatchObject({ aspect: '9:16', autoplay: true, start: 90 })
  })

  it('icon: searches the icon grid, picks an icon, size and decorative label', async () => {
    mockStore()
    const { user, last } = setup(node('icon'), { locales: ['en', 'bn'] })
    const grid = screen.getByRole('group', { name: 'Icons' })
    expect(within(grid).getByRole('button', { name: 'Star' })).toHaveAttribute('aria-pressed', 'true')
    await user.type(screen.getByRole('searchbox', { name: 'Search icons' }), 'tru')
    expect(within(grid).getAllByRole('button')).toHaveLength(1)
    await user.click(within(grid).getByRole('button', { name: 'Truck' }))
    expect(last().props).toMatchObject({ name: 'truck' })

    const size = screen.getByLabelText('Size')
    await user.clear(size)
    await user.type(size, '200')
    expect(await screen.findByText('Enter a whole number from 16 to 128.')).toBeInTheDocument()
    await user.clear(size)
    await user.type(size, '48')
    await user.type(screen.getByLabelText('Name for screen readers'), 'Free delivery')
    expect(last().props).toMatchObject({ size: 48, label: 'Free delivery' })

    await user.click(screen.getByRole('button', { name: /বাংলা/ }))
    await user.type(screen.getByLabelText('Name for screen readers in Bangla'), 'ফ্রি ডেলিভারি')
    expect(last().translations).toEqual({ bn: { label: 'ফ্রি ডেলিভারি' } })
  })

  it('countdown: a date in the store time zone, or a flash sale from the promotions', async () => {
    mockStore({
      'GET /promotions': ok([promotion(UUID, 'Eid flash sale', { show_countdown: true }), promotion(UUID2, 'Welcome coupon')], pagination(2)),
    })
    const { user, last } = setup(node('countdown'))
    expect(screen.getByText('Choose the date and time the countdown ends.')).toBeInTheDocument()
    expect(await screen.findByText(/In your store’s time zone \(Asia\/Dhaka\)/)).toBeInTheDocument()
    const ends = screen.getByLabelText('Ends at')
    await user.type(ends, '2026-12-01T18:30')
    await waitFor(() => expect(last().props).toMatchObject({ ends_at: '2026-12-01T18:30:00+06:00' }))
    expect(screen.queryByText('Choose the date and time the countdown ends.')).toBeNull()

    await user.click(screen.getByRole('combobox', { name: 'Count down to' }))
    await user.click(await screen.findByRole('option', { name: 'The end of a sale' }))
    expect(await screen.findByText('Choose the sale to count down to.')).toBeInTheDocument()
    const sale = screen.getByRole('combobox', { name: 'Sale' })
    await waitFor(() => expect(sale).toBeEnabled())
    await user.click(sale)
    expect(screen.queryByRole('option', { name: /Welcome coupon/ })).toBeNull()
    await user.click(await screen.findByRole('option', { name: /Eid flash sale/ }))
    expect(last().props).toMatchObject({ source: 'promotion', promotion_id: UUID })
    expect(screen.getByRole('link', { name: /Manage promotions/ })).toHaveAttribute('href', '/promotions')

    await user.type(screen.getByLabelText('When the time is up'), 'The sale has ended')
    expect(last().props).toMatchObject({ expired_text: 'The sale has ended' })
  })

  it('discount: percent / amount promotions, coupon code preview and hiding the code', async () => {
    mockStore({
      'GET /promotions': ok([promotion(UUID, 'Welcome coupon'), promotion(UUID2, 'Free delivery', { type: 'free_shipping', value: null })], pagination(2)),
      [`GET /promotions/${UUID}`]: ok({ ...promotion(UUID, 'Welcome coupon'), description: null, min_subtotal: null, max_discount: null, usage_limit: null, usage_limit_per_customer: null, targets: [], coupons_preview: [{ code: 'WELCOME10' }] }),
    })
    const { user, last } = setup(node('discount'))
    expect(screen.getByText('Choose the promotion to show.')).toBeInTheDocument()
    const picker = screen.getByRole('combobox', { name: 'Promotion' })
    await waitFor(() => expect(picker).toBeEnabled())
    await user.click(picker)
    expect(screen.queryByRole('option', { name: /Free delivery/ })).toBeNull()
    await user.click(await screen.findByRole('option', { name: 'Welcome coupon (10 % off, coupon)' }))
    expect(last().props).toMatchObject({ promotion_id: UUID })
    expect(await screen.findByTestId('coupon-preview')).toHaveTextContent('WELCOME10')

    await user.click(screen.getByRole('switch', { name: 'Show the coupon code' }))
    expect(last().props).toMatchObject({ show_code: false })
    expect(screen.getByText(/The coupon code is hidden/)).toBeInTheDocument()
  })

  it('call to action: title required, a second button on demand, Bangla keys for nested labels', async () => {
    mockStore()
    const { user, last } = setup(node('cta'), { locales: ['en', 'bn'] })
    await user.clear(screen.getByLabelText('Title'))
    expect(await screen.findByText('Enter the title.')).toBeInTheDocument()
    await user.type(screen.getByLabelText('Title'), 'Fresh every day')

    const buttonText = screen.getByLabelText('Button text')
    await user.clear(buttonText)
    expect(await screen.findByText('Enter the button text.')).toBeInTheDocument()
    await user.type(buttonText, 'Order now')
    expect(last().props).toMatchObject({ title: 'Fresh every day', primary: { label: 'Order now', link: { url: '/shop' } }, secondary: null })

    await user.click(screen.getByRole('switch', { name: 'Second button' }))
    expect(last().props).toMatchObject({ secondary: { label: 'Learn more', link: { url: '/' } } })
    await user.click(screen.getByRole('combobox', { name: 'Second button opens' }))
    await user.click(await screen.findByRole('option', { name: 'About us' }))
    expect(last().props).toMatchObject({ secondary: { label: 'Learn more', link: { url: '/pages/about-us' } } })

    await user.click(screen.getByRole('button', { name: /বাংলা/ }))
    await user.type(screen.getByLabelText('Button text in Bangla'), 'অর্ডার')
    expect(last().translations).toEqual({ bn: { 'primary.label': 'অর্ডার' } })
    expect(validateNode(last())).toEqual([])
  })

  it('search box and newsletter form texts', async () => {
    mockStore()
    const search = setup(node('search_box'))
    await search.user.type(screen.getByLabelText('Button text'), 'Go')
    expect(search.last().props).toMatchObject({ placeholder: 'Search products', button_label: 'Go' })
  })

  it('newsletter form: button text required, layout', async () => {
    mockStore()
    const { user, last } = setup(node('newsletter_form'))
    await user.clear(screen.getByLabelText('Button text'))
    expect(await screen.findByText('Enter the button text.')).toBeInTheDocument()
    await user.click(screen.getByRole('combobox', { name: 'Layout' }))
    await user.click(await screen.findByRole('option', { name: 'Stacked' }))
    expect(last().props).toMatchObject({ button_label: '', layout: 'stacked' })
    expect(screen.getByRole('link', { name: /Content → Newsletter/ })).toHaveAttribute('href', '/content/newsletter')
  })

  it('promoted product: picks a product with the existing product search; an empty title uses the product name', async () => {
    mockStore({
      'GET /products': ok([{ id: UUID3, name: 'Mango pickle', variants: [{ sku: 'MP-1' }], images: [], is_active: true }], pagination(1)),
      [`GET /products/${UUID3}`]: ok({ id: UUID3, name: 'Mango pickle', images: [] }),
    })
    const { user, last } = setup(node('promo_card'))
    expect(screen.getByText('Choose the product to promote.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Choose product' }))
    await user.click(await screen.findByRole('option', { name: /Mango pickle/ }))
    expect(last().props).toMatchObject({ product_id: UUID3, title: null })
    expect(await screen.findByTestId('chosen-product')).toHaveTextContent('Mango pickle')
    await user.type(screen.getByLabelText('Badge'), 'Best seller')
    await user.type(screen.getByLabelText('Title'), 'x')
    await user.clear(screen.getByLabelText('Title'))
    expect(last().props).toMatchObject({ badge: 'Best seller', title: null })
  })
})

describe('B4 forms: header and footer parts', () => {
  it('menu: menu picker with a link to Menus; header sub-items offer drop-downs, footer ones a list', async () => {
    mockStore({ 'GET /storefront/menus': ok([{ id: UUID, name: 'Main menu', location: 'main', location_label: 'Main', is_active: true, updated_at: null }]) })
    const header = setup(node('menu'), { kind: 'header', key: 'header' })
    expect(screen.getByText('Choose a menu.')).toBeInTheDocument()
    const picker = screen.getByRole('combobox', { name: 'Menu' })
    await waitFor(() => expect(picker).toBeEnabled())
    await header.user.click(picker)
    await header.user.click(await screen.findByRole('option', { name: 'Main menu · Main' }))
    expect(header.last().props).toMatchObject({ menu_id: UUID })
    expect(screen.getByRole('link', { name: /Manage menus/ })).toHaveAttribute('href', '/storefront/menus')
    await header.user.click(screen.getByRole('combobox', { name: 'Sub-items' }))
    expect(await screen.findByRole('option', { name: 'Large drop-down (mega menu)' })).toBeInTheDocument()
  })

  it('a footer menu starts as a list and offers list sub-items only', async () => {
    mockStore({ 'GET /storefront/menus': ok([]) })
    const footerMenu = buildElement('menu', registry, new Set(), 'footer')!
    expect(footerMenu.props).toMatchObject({ layout: 'vertical', show_children: 'list' })
    const { user } = setup({ ...footerMenu, id: 'e_test01' } as Element, { kind: 'footer', key: 'footer' })
    expect(await screen.findByText(/You have no menus yet/)).toBeInTheDocument()
    await user.click(screen.getByRole('combobox', { name: 'Sub-items' }))
    expect(await screen.findByRole('option', { name: 'Sub-items listed below' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /drop-down/ })).toBeNull()
  })

  it('cart, account, wishlist and language switch toggles', async () => {
    mockStore()
    const cart = setup(node('cart_icon'))
    await cart.user.click(screen.getByRole('switch', { name: 'Show the cart total' }))
    await cart.user.click(screen.getByRole('switch', { name: 'Show the number of items' }))
    expect(cart.last().props).toEqual({ show_count: false, show_total: true })
  })

  it('account and language switch', async () => {
    mockStore()
    const account = setup(node('account_link'))
    await account.user.click(screen.getByRole('switch', { name: 'Show the word “Account” next to the icon' }))
    expect(account.last().props).toEqual({ show_label: true })
  })

  it('language switch style', async () => {
    mockStore()
    const { user, last } = setup(node('language_switch'), { kind: 'footer', key: 'footer' })
    await user.click(screen.getByRole('combobox', { name: 'Look' }))
    await user.click(await screen.findByRole('option', { name: 'A drop-down list' }))
    expect(last().props).toEqual({ style: 'select' })
  })

  it('social, payment and contact details link to the Theme page where their data lives', async () => {
    mockStore()
    const social = setup(node('social_icons'))
    await social.user.click(screen.getByRole('combobox', { name: 'Shape' }))
    await social.user.click(await screen.findByRole('option', { name: 'In circles' }))
    expect(social.last().props).toMatchObject({ style: 'circle', size: 24 })
    expect(screen.getByRole('link', { name: /Theme page/ })).toHaveAttribute('href', '/storefront/theme')
  })

  it('contact details toggles and layout', async () => {
    mockStore()
    const { user, last } = setup(node('contact_block'))
    await user.click(screen.getByRole('switch', { name: 'Address' }))
    await user.click(screen.getByRole('combobox', { name: 'Layout' }))
    await user.click(await screen.findByRole('option', { name: 'In one line' }))
    expect(last().props).toEqual({ show_phone: true, show_email: true, show_address: false, layout: 'inline' })
  })

  it('copyright: {year} hint; empty uses the theme copyright (null)', async () => {
    mockStore()
    const { user, last } = setup(node('copyright'))
    expect(screen.getByText(/Write \{year\} for the current year/)).toBeInTheDocument()
    await user.type(screen.getByLabelText('Copyright text'), '© {{year} Green Basket')
    expect(last().props).toEqual({ text: '© {year} Green Basket' })
    await user.clear(screen.getByLabelText('Copyright text'))
    expect(last().props).toEqual({ text: null })
  })

  it('logo height bounds', async () => {
    mockStore()
    const { user } = setup(node('logo'))
    const height = screen.getByLabelText('Height')
    await user.clear(height)
    await user.type(height, '10')
    expect(await screen.findByText('Enter a whole number from 24 to 96.')).toBeInTheDocument()
  })
})

describe('B4 forms: CMS page elements and custom HTML', () => {
  it('FAQ list and contact form', async () => {
    mockStore()
    const faq = setup(node('faq_list'), { key: `cms:${UUID}` })
    await faq.user.click(screen.getByRole('combobox', { name: 'Look' }))
    await faq.user.click(await screen.findByRole('option', { name: 'All answers shown' }))
    expect(faq.last().props).toEqual({ title: null, style: 'list' })
    expect(screen.getByRole('link', { name: /Content → FAQ/ })).toHaveAttribute('href', '/content/faq')
  })

  it('contact form details toggle', async () => {
    mockStore()
    const { user, last } = setup(node('contact_form'), { key: `cms:${UUID}` })
    await user.type(screen.getByLabelText('Title'), 'Write to us')
    await user.click(screen.getByRole('switch', { name: 'Show your store’s contact details' }))
    expect(last().props).toEqual({ title: 'Write to us', show_details: false })
  })

  it('custom HTML: editable with the permission, with a warning', async () => {
    mockStore()
    const { user, last } = setup(node('custom_html', { html: '<p>Hi</p>' }), { canCustomHtml: true })
    expect(screen.getByRole('note')).toHaveTextContent(/scripts, embeds \(iframes\)/)
    await user.type(screen.getByLabelText('HTML'), '<b>!</b>')
    expect(last().props).toEqual({ html: '<p>Hi</p><b>!</b>' })
  })

  it('custom HTML: read only and explained without the permission', () => {
    mockStore()
    setup(node('custom_html', { html: '<p>Hi</p>' }))
    expect(screen.getByTestId('custom-html-locked')).toHaveTextContent('Only people allowed to use custom HTML can change this')
    expect(screen.getByLabelText('HTML (read only)')).toHaveAttribute('readonly')
    expect(screen.getByLabelText('HTML (read only)')).toHaveValue('<p>Hi</p>')
  })
})

describe('createElement: B4 setup dialog', () => {
  it('a video asks for its link and title before it is inserted', async () => {
    mockStore()
    const { user } = setup(node('heading' as string, {}) as Element)
    let pending!: Promise<BuilderNode | null>
    act(() => {
      pending = createElement('video', { registry, existingIds: new Set(['s_sec001']) })
    })
    const dialog = await screen.findByRole('dialog', { name: 'Add video' })
    const insert = within(dialog).getByRole('button', { name: 'Insert' })
    expect(insert).toBeDisabled()
    await user.type(within(dialog).getByLabelText('Video link'), 'https://www.youtube.com/watch?v=dQw4w9WgXcQ')
    expect(insert).toBeDisabled()
    await user.type(within(dialog).getByLabelText('Video title'), 'Our farm')
    expect(insert).toBeEnabled()
    await user.click(insert)
    await expect(pending).resolves.toMatchObject({ type: 'video', props: { provider: 'youtube', video_id: 'dQw4w9WgXcQ', title: 'Our farm' } })
  })

  it('elements that are valid by default are inserted directly', async () => {
    await expect(createElement('icon', { registry, existingIds: new Set() })).resolves.toMatchObject({ type: 'icon', props: { name: 'star' } })
    await expect(createElement('cta', { registry, existingIds: new Set() })).resolves.toMatchObject({ type: 'cta' })
    await expect(createElement('copyright', { registry, existingIds: new Set(), context: 'footer' })).resolves.toMatchObject({ type: 'copyright', props: { text: null } })
  })
})
