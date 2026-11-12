import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mockApi, ok, renderRoutes } from '@/test/utils'
import { documentOf, elementNode, payloadOf } from './builder/test-payload'
import { listingGridClasses } from './builder/listing-columns'
import { documentContext, ELEMENT_REGISTRY, elementMeta, isAllowedIn } from './builder/registry'
import { ICON_NAMES } from './builder/icons'
import { DEFAULT_LISTING_COLUMNS, normalizeListingColumns, parseVideoUrl, videoEmbedUrl } from './builder/validate'
import { DESKTOP_QUERY, TABLET_UP_QUERY } from './components/use-media-query'
import { storefrontRoutes } from './routes'
import { bilingualBootstrap, bootstrapFixture, cartFixture, listingBody, menuNode, productCard, productDetail, resetLocale } from './test-fixtures'
import type { BuilderData, BuilderDocument, BuilderPage, Element } from './builder/types'
import elementsJson from './builder/__fixtures__/sample-b4-elements.v1.json'
import footerJson from './builder/__fixtures__/sample-footer.v1.json'
import headerJson from './builder/__fixtures__/sample-header.v1.json'
import type { StorefrontBootstrap, StorePage } from './types'

afterEach(resetLocale)

const headerFixture = headerJson as unknown as BuilderDocument
const footerFixture = footerJson as unknown as BuilderDocument
const elementsFixture = elementsJson as unknown as BuilderDocument

/** jsdom matches no media query; these tests choose the viewport. */
function viewport(width: number) {
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) =>
      ({
        matches: (query === TABLET_UP_QUERY && width >= 768) || (query === DESKTOP_QUERY && width >= 1024),
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }) as MediaQueryList,
  )
}

const footerTheme = (base = bootstrapFixture()): StorefrontBootstrap['theme'] => ({
  ...base.theme,
  footer: {
    about: 'Fresh food from local farms.',
    copyright: null,
    contact: { email: 'hello@berry.test', phone: '+880 1711-000000', address: 'Road 1, Dhaka' },
    social: { facebook: 'https://facebook.com/berry', instagram: 'https://instagram.com/berry' },
    payment_logos: [{ id: 'pay-1', url: '/storage/media/o/bkash.png', srcset: '', width: 120, height: 40, alt: 'bKash' }],
  },
})

function page(slug: string, overrides: Partial<StorePage> = {}): StorePage {
  return {
    slug,
    title: 'About us',
    template: 'default',
    body_html: '<p>The classic CMS body.</p>',
    published_at: null,
    seo_title: 'About Berry Kids',
    seo_description: 'Who we are',
    updated_at: null,
    ...overrides,
  }
}

/** A CMS page at /pages/<slug> whose builder payload draws these elements. */
function renderCmsPage(elements: Element[], options: { data?: Record<string, BuilderData>; bootstrap?: StorefrontBootstrap; source?: 'published' | 'draft'; overrides?: Partial<StorePage> } = {}) {
  const builder = payloadOf(documentOf(elements), { key: 'cms:01a1c9d9-0000-7000-8000-0000000000aa', title: 'About us', data: options.data, source: options.source })
  const fetchMock = mockApi({
    'GET /store/bootstrap': ok(options.bootstrap ?? bootstrapFixture({ theme: footerTheme() })),
    'GET /store/pages/about': ok(page('about', { builder, ...options.overrides })),
    'GET /store/cart': ok(cartFixture()),
    'GET /store/wishlist': ok({ items: [] }),
    'POST /store/newsletter': ok({ message: 'Check your inbox to confirm.' }),
    'POST /store/contact': ok({ message: 'Thanks, we will reply soon.' }),
  })
  return { fetchMock, ...renderRoutes(storefrontRoutes, '/pages/about') }
}

/* ============================================================================================== */

describe('B4 shared metadata', () => {
  it('knows every B4 type with its allowed contexts and translatable props', () => {
    expect(isAllowedIn('faq_list', 'cms')).toBe(true)
    expect(isAllowedIn('faq_list', 'page')).toBe(false)
    expect(isAllowedIn('cart_icon', 'header')).toBe(true)
    expect(isAllowedIn('cart_icon', 'footer')).toBe(false)
    expect(isAllowedIn('copyright', 'footer')).toBe(true)
    expect(isAllowedIn('video', 'zone')).toBe(true)
    expect(isAllowedIn('hero_slider', 'header')).toBe(false)
    expect(elementMeta('cta')?.translatable).toEqual(['title', 'text', 'primary.label', 'secondary.label'])
    expect(elementMeta('logo')?.group).toBe('site')
    expect(ELEMENT_REGISTRY.every((meta) => meta.allowed_in.length > 0)).toBe(true)
    expect(documentContext('cms:abc')).toBe('cms')
    expect(documentContext('zone:listing.top')).toBe('zone')
    expect(documentContext('landing:spring')).toBe('page')
    expect(documentContext('header')).toBe('header')
    expect(ICON_NAMES).toHaveLength(20)
  })

  it('parses the video URL forms the server accepts and builds privacy-enhanced embeds', () => {
    expect(parseVideoUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toEqual({ provider: 'youtube', video_id: 'dQw4w9WgXcQ' })
    expect(parseVideoUrl('https://youtu.be/dQw4w9WgXcQ?t=10')).toEqual({ provider: 'youtube', video_id: 'dQw4w9WgXcQ' })
    expect(parseVideoUrl('https://youtube.com/shorts/abcDEF123')).toEqual({ provider: 'youtube', video_id: 'abcDEF123' })
    expect(parseVideoUrl('https://vimeo.com/76979871')).toEqual({ provider: 'vimeo', video_id: '76979871' })
    expect(parseVideoUrl('https://evil.test/watch?v=dQw4w9WgXcQ')).toBeNull()
    expect(parseVideoUrl('javascript:alert(1)')).toBeNull()
    expect(parseVideoUrl(`https://youtu.be/${'a'.repeat(600)}`)).toBeNull()
    expect(videoEmbedUrl('youtube', 'dQw4w9WgXcQ', { start: 30 })).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0&autoplay=1&start=30')
    expect(videoEmbedUrl('vimeo', '76979871', { autoplay: true })).toBe('https://player.vimeo.com/video/76979871?dnt=1&autoplay=1&muted=1')
    expect(videoEmbedUrl('youtube', 'bad id')).toBeNull()
  })

  it('keeps today’s listing grid by default and spells every per-device class', () => {
    expect(normalizeListingColumns(undefined)).toEqual(DEFAULT_LISTING_COLUMNS)
    expect(normalizeListingColumns({ desktop: 9, tablet: 3, mobile: 1 })).toEqual({ desktop: 3, tablet: 3, mobile: 1 })
    expect(listingGridClasses(DEFAULT_LISTING_COLUMNS)).toBe('grid-cols-2 md:grid-cols-3 lg:grid-cols-3')
    expect(listingGridClasses({ desktop: 5, tablet: 4, mobile: 1 })).toBe('grid-cols-1 md:grid-cols-4 lg:grid-cols-5')
  })
})

/* ============================================================================================== */

describe('B4 element renderers', () => {
  it('loads a video only after a click, into a privacy-enhanced lazy iframe', async () => {
    const user = userEvent.setup()
    const { container } = renderCmsPage([
      elementNode('video', 'e_video', { url: 'https://youtu.be/dQw4w9WgXcQ', provider: 'youtube', video_id: 'dQw4w9WgXcQ', title: 'Our farm', start: 5 }),
    ])

    const play = await screen.findByRole('button', { name: 'Play video: Our farm' })
    expect(container.querySelector('iframe')).toBeNull()
    await user.click(play)
    const frame = container.querySelector('iframe')!
    expect(frame).toHaveAttribute('src', 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0&autoplay=1&start=5')
    expect(frame).toHaveAttribute('title', 'Our farm')
    expect(frame).toHaveAttribute('loading', 'lazy')
    expect(frame.closest('[data-b]')).toHaveAttribute('data-b', 'e_video')
    expect(frame).toHaveFocus()
  })

  it('names icons that have a label and hides decorative ones', async () => {
    const { container } = renderCmsPage([
      elementNode('icon', 'e_icon_named', { name: 'leaf', label: 'Organic', size: 48, color: '#16a34a' }),
      elementNode('icon', 'e_icon_deco', { name: 'truck' }),
      elementNode('icon', 'e_icon_link', { name: 'phone', label: 'Call us', link: { url: '/pages/contact' } }),
      elementNode('icon', 'e_icon_bad', { name: 'skull' }),
    ])
    const named = await screen.findByRole('img', { name: 'Organic' })
    expect(named).toHaveAttribute('width', '48')
    expect(container.querySelector('[data-b="e_icon_named"]')).toHaveStyle({ color: '#16a34a' })
    expect(container.querySelector('[data-b="e_icon_deco"] svg')).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByRole('link', { name: 'Call us' })).toHaveAttribute('href', '/pages/contact')
    expect(container.querySelector('[data-b="e_icon_bad"]')).toBeNull()
  })

  it('shows a discount with its code and copies the code with a confirmation', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    renderCmsPage([elementNode('discount', 'e_deal', { promotion_id: '01a1c9d9-0000-7000-8000-0000000000f1', title: 'Eid offer', text: 'On everything' })], {
      data: { e_deal: { name: 'Eid', kind: 'percent', value: '10.00', coupon_code: 'EID10', min_subtotal: '500.00', ends_at: null } },
    })

    const deal = await screen.findByTestId('builder-discount')
    expect(within(deal).getByText('10% off')).toBeInTheDocument()
    expect(within(deal).getByRole('heading', { name: 'Eid offer' })).toBeInTheDocument()
    expect(within(deal).getByText(/On orders of/)).toHaveTextContent('500')
    expect(within(deal).getByTestId('coupon-code')).toHaveTextContent('EID10')
    fireEvent.click(within(deal).getByRole('button', { name: 'Copy the code EID10' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('EID10'))
    expect(await screen.findByText('Code EID10 copied')).toBeInTheDocument()
  })

  it('falls back to selecting the code when the clipboard is unavailable', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
    renderCmsPage([elementNode('discount', 'e_deal', { promotion_id: '01a1c9d9-0000-7000-8000-0000000000f1' })], {
      data: { e_deal: { name: 'Flat 50', kind: 'fixed', value: '50.00', coupon_code: 'FLAT50', min_subtotal: null, ends_at: null } },
    })
    fireEvent.click(await screen.findByRole('button', { name: 'Copy the code FLAT50' }))
    expect(await screen.findByText(/Copying did not work/)).toBeInTheDocument()
    expect(window.getSelection()?.toString()).toBe('FLAT50')
    // The heading falls back to the promotion's name.
    expect(screen.getByRole('heading', { name: 'Flat 50' })).toBeInTheDocument()
  })

  it('hides a discount without a code when the element does not show it, and never shows inactive ones', async () => {
    const { container } = renderCmsPage(
      [elementNode('discount', 'e_open', { promotion_id: '01a1c9d9-0000-7000-8000-0000000000f1' }), elementNode('discount', 'e_old', { promotion_id: '01a1c9d9-0000-7000-8000-0000000000f2' })],
      {
        data: {
          e_open: { name: 'Summer', kind: 'percent', value: '15.50', coupon_code: null, min_subtotal: null, ends_at: null },
          e_old: { name: 'Old', kind: 'percent', value: '5.00', coupon_code: 'OLD', min_subtotal: null, ends_at: null, state: 'inactive' },
        },
      },
    )
    expect(await screen.findByText('15.5% off')).toBeInTheDocument()
    expect(screen.queryByTestId('coupon')).toBeNull()
    expect(container.querySelector('[data-b="e_old"]')).toBeNull()
  })

  it('counts down to the end and shows the expired text afterwards (or nothing)', async () => {
    const future = new Date(Date.now() + 26 * 3600_000).toISOString()
    const past = new Date(Date.now() - 60_000).toISOString()
    const { container } = renderCmsPage(
      [
        elementNode('countdown', 'e_live', { ends_at: future, title: 'Sale ends soon' }),
        elementNode('countdown', 'e_over', { ends_at: past, title: 'Flash sale', expired_text: 'This sale has ended' }),
        elementNode('countdown', 'e_gone', { ends_at: past, title: 'Gone' }),
      ],
      { data: { e_live: { ends_at: future, promotion: null }, e_over: { ends_at: past, promotion: null }, e_gone: { ends_at: past, promotion: null } } },
    )
    const live = await screen.findByText('Sale ends soon')
    expect(within(live.closest('[data-b]') as HTMLElement).getByTestId('countdown')).toBeInTheDocument()
    expect(screen.getByText('This sale has ended')).toBeInTheDocument()
    expect(container.querySelector('[data-b="e_gone"]')).toBeNull()
  })

  it('draws a dated countdown from its props without data, and does not mark an ended one that keeps its text', async () => {
    const future = new Date(Date.now() + 3600_000).toISOString()
    const past = new Date(Date.now() - 60_000).toISOString()
    renderCmsPage(
      [elementNode('countdown', 'e_date', { ends_at: future, title: 'Opening soon' }), elementNode('countdown', 'e_done', { ends_at: past, title: 'Done', expired_text: 'See you next year' })],
      { source: 'draft', data: { e_done: { ends_at: past, promotion: null, state: 'expired' } } },
    )
    expect(await screen.findByText('Opening soon')).toBeInTheDocument()
    expect(screen.getByText('See you next year')).toBeInTheDocument()
    expect(screen.queryByText('Ended — no longer shown')).toBeNull()
  })

  it('switches to the expired text when the time runs out on the page', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const end = new Date(Date.now() + 2_000).toISOString()
      renderCmsPage([elementNode('countdown', 'e_soon', { ends_at: end, title: 'Last call', expired_text: 'Too late!' })], { data: { e_soon: { ends_at: end, promotion: null } } })
      expect(await screen.findByTestId('countdown')).toBeInTheDocument()
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3_000)
      })
      expect(screen.getByText('Too late!')).toBeInTheDocument()
      expect(screen.queryByTestId('countdown')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('draws a promoted product with its badge and price, and drops an unavailable one', async () => {
    const { container } = renderCmsPage(
      [
        elementNode('promo_card', 'e_promo', { product_id: '01a1c9d9-0000-7000-8000-0000000000c1', badge: 'New', text: 'Pressed this morning', button_label: 'Buy now' }),
        elementNode('promo_card', 'e_sold', { product_id: '01a1c9d9-0000-7000-8000-0000000000c2' }),
      ],
      { data: { e_promo: productCard('mango-juice', { price: '150.00', price_max: '150.00' }), e_sold: { ...productCard('old-juice'), state: 'unavailable' } } },
    )
    const card = await screen.findByTestId('builder-promo-card')
    expect(within(card).getByRole('heading', { name: 'Mango Juice' })).toBeInTheDocument()
    expect(within(card).getByRole('link', { name: 'Mango Juice' })).toHaveAttribute('href', '/product/mango-juice')
    expect(within(card).getByRole('link', { name: 'Buy now' })).toHaveAttribute('href', '/product/mango-juice')
    expect(within(card).getByTestId('promo-badge')).toHaveTextContent('New')
    expect(within(card).getByText('Pressed this morning')).toBeInTheDocument()
    expect(within(card).getByTestId('price')).toHaveTextContent('150')
    expect(container.querySelector('[data-b="e_sold"]')).toBeNull()
  })

  it('marks data a visitor would not see in a draft preview', async () => {
    renderCmsPage([elementNode('promo_card', 'e_sold', { product_id: '01a1c9d9-0000-7000-8000-0000000000c2' }), elementNode('discount', 'e_none', {})], {
      source: 'draft',
      data: { e_sold: { ...productCard('old-juice'), state: 'unavailable' } },
    })
    expect(await screen.findByText('Not available — visitors do not see this')).toBeInTheDocument()
    expect(screen.getByText('Old Juice')).toBeInTheDocument()
    // No data at all (not set up yet): a marked placeholder.
    expect(screen.getByText('Nothing to show — visitors do not see this')).toBeInTheDocument()
  })

  it('renders a call to action with its buttons', async () => {
    renderCmsPage([
      elementNode('cta', 'e_cta', {
        title: 'Ready for fresh food?',
        text: 'Delivered to your door.',
        primary: { label: 'Order now', link: { url: '/shop' } },
        secondary: { label: 'Learn more', link: { url: 'javascript:alert(1)' } },
        align: 'left',
      }),
    ])
    const cta = await screen.findByTestId('builder-cta')
    expect(within(cta).getByRole('heading', { level: 2, name: 'Ready for fresh food?' })).toBeInTheDocument()
    expect(within(cta).getByRole('link', { name: 'Order now' })).toHaveAttribute('href', '/shop')
    // An unsafe link is never followed: that button is not drawn.
    expect(within(cta).queryByRole('link', { name: 'Learn more' })).toBeNull()
    expect(cta).toHaveClass('items-start')
  })

  it('cleans custom HTML again before drawing it', async () => {
    const { container } = renderCmsPage([
      elementNode('custom_html', 'e_html', { html: '<p onclick="alert(1)">Hello <strong>there</strong></p><script>alert(1)</script><iframe src="https://x.test"></iframe><a href="javascript:alert(1)">bad</a>' }),
    ])
    await screen.findByText('there')
    const html = container.querySelector('[data-b="e_html"]')!
    expect(html).toHaveClass('sf-rich-text')
    expect(html.querySelector('script, iframe')).toBeNull()
    expect(html.querySelector('p')).not.toHaveAttribute('onclick')
    expect(html.querySelector('a')).not.toHaveAttribute('href')
    expect(within(html as HTMLElement).getByText('there').tagName).toBe('STRONG')
  })

  it('subscribes from a newsletter form element', async () => {
    const user = userEvent.setup()
    const { fetchMock } = renderCmsPage([elementNode('newsletter_form', 'e_news', { title: 'Weekly deals', button_label: 'Join' })])
    const form = await screen.findByRole('form', { name: 'Weekly deals' })
    await user.type(within(form).getByLabelText('E-mail address'), 'a@b.test')
    await user.click(within(form).getByRole('button', { name: 'Join' }))
    expect(await screen.findByText('Check your inbox to confirm.')).toBeInTheDocument()
    const call = fetchMock.mock.calls.find(([url, init]) => String(url).includes('/store/newsletter') && init?.method === 'POST')
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({ email: 'a@b.test' })
  })

  it('draws social icons, payment logos, contact details and a copyright line from the theme', async () => {
    renderCmsPage([
      elementNode('social_icons', 'e_social', { style: 'circle', size: 32 }),
      elementNode('payment_icons', 'e_pay', { height: 32 }),
      elementNode('contact_block', 'e_contact', { show_address: false, layout: 'inline' }),
      elementNode('copyright', 'e_copy', { text: '© {year} Berry Kids Ltd.' }),
    ])
    const social = await screen.findByTestId('builder-social')
    expect(social).toHaveAccessibleName('Social media')
    expect(within(social).getByRole('link', { name: /Facebook/ })).toHaveAttribute('href', 'https://facebook.com/berry')
    expect(within(social).getByRole('link', { name: /Instagram/ })).toHaveAttribute('target', '_blank')
    const payment = screen.getByTestId('builder-payment')
    expect(payment.querySelector('img')).toHaveStyle({ height: '32px' })
    const contact = screen.getByTestId('builder-contact')
    expect(within(contact).getByRole('link', { name: 'hello@berry.test' })).toHaveAttribute('href', 'mailto:hello@berry.test')
    expect(within(contact).queryByText('Road 1, Dhaka')).toBeNull()
    expect(screen.getByTestId('builder-copyright')).toHaveTextContent(`© ${new Date().getFullYear()} Berry Kids Ltd.`)
  })

  it('switches the language from a select', async () => {
    const user = userEvent.setup()
    const fetchMock = mockApi({
      'GET /store/bootstrap': ok(bilingualBootstrap()),
      'GET /store/pages/about': ok(page('about', { builder: payloadOf(documentOf([elementNode('language_switch', 'e_lang', { style: 'select' })])) })),
    })
    renderRoutes(storefrontRoutes, '/pages/about')
    const select = await screen.findByRole('combobox', { name: 'Language' })
    await user.selectOptions(select, 'bn')
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/store/bootstrap?lang=bn'))).toBe(true))
  })
})

/* ============================================================================================== */

describe('CMS pages designed in the builder', () => {
  it('draws the design instead of the CMS body, keeping the title band and the page SEO', async () => {
    renderCmsPage([elementNode('heading', 'e_h', { text: 'Our story', level: 2 }), elementNode('text', 'e_t', { html: '<p>Since 2010.</p>' })])
    const article = await screen.findByTestId('content-page')
    expect(within(article).getByRole('heading', { level: 1, name: 'About us' })).toBeInTheDocument()
    expect(within(article).getByRole('heading', { level: 2, name: 'Our story' })).toBeInTheDocument()
    expect(screen.queryByText('The classic CMS body.')).toBeNull()
    await waitFor(() => expect(document.title).toContain('About Berry Kids'))
  })

  it('leaves the title to a design that has its own level-1 heading', async () => {
    renderCmsPage([elementNode('heading', 'e_h1', { text: 'Who we are', level: 1 })])
    expect(await screen.findByRole('heading', { level: 1, name: 'Who we are' })).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
  })

  it('keeps the classic page when there is no builder payload', async () => {
    mockApi({ 'GET /store/bootstrap': ok(bootstrapFixture()), 'GET /store/pages/about': ok(page('about', { builder: null })) })
    renderRoutes(storefrontRoutes, '/pages/about')
    expect(await screen.findByText('The classic CMS body.')).toBeInTheDocument()
    expect(screen.queryByTestId('builder-page')).toBeNull()
  })

  it('keeps the FAQ accordion working (data from the payload)', async () => {
    const user = userEvent.setup()
    renderCmsPage([elementNode('faq_list', 'e_faq', { title: 'Questions' })], {
      overrides: { template: 'faq' },
      data: { e_faq: { groups: [{ group: 'Delivery', items: [{ id: 'q1', question: 'Do you deliver?', answer_html: '<p>Yes, all over Dhaka.</p>' }] }] } },
    })
    const faq = await screen.findByTestId('builder-faq')
    const question = within(faq).getByText('Do you deliver?')
    const details = question.closest('details')!
    expect(details.open).toBe(false)
    await user.click(question)
    expect(details.open).toBe(true)
    expect(within(faq).getByText('Yes, all over Dhaka.')).toBeVisible()
  })

  it('falls back to the page’s own FAQ items, and lists them when asked', async () => {
    renderCmsPage([elementNode('faq_list', 'e_faq', { style: 'list' })], {
      overrides: { template: 'faq', faq: [{ group: null, items: [{ id: 'q1', question: 'Can I return?', answer_html: '<p>Within 7 days.</p>' }] }] },
    })
    const faq = await screen.findByTestId('builder-faq')
    expect(within(faq).getByRole('heading', { name: 'Can I return?' })).toBeInTheDocument()
    expect(faq.querySelector('details')).toBeNull()
  })

  it('keeps the contact form working, with the store details', async () => {
    const user = userEvent.setup()
    const { fetchMock } = renderCmsPage([elementNode('contact_form', 'e_contact', { title: 'Write to us' })], { overrides: { template: 'contact' } })
    const block = await screen.findByTestId('builder-contact-form')
    expect(within(block).getByTestId('contact-details')).toHaveTextContent('Road 1, Dhaka')
    await user.type(within(block).getByLabelText('Your name'), 'Rahim')
    await user.type(within(block).getByLabelText('E-mail'), 'rahim@example.com')
    await user.type(within(block).getByLabelText('Message'), 'Do you sell mangoes?')
    await user.click(within(block).getByRole('button', { name: /Send/ }))
    expect(await screen.findByText('Thanks, we will reply soon.')).toBeInTheDocument()
    expect(fetchMock.mock.calls.some(([url, init]) => String(url).includes('/store/contact') && init?.method === 'POST')).toBe(true)
  })

  it('asks for the draft in a staff preview and says so', async () => {
    window.history.replaceState(null, '', '/?preview=draft')
    const builder = payloadOf(documentOf([elementNode('heading', 'e_h', { text: 'Draft story' }, { hidden: true })]), { source: 'draft' })
    const fetchMock = mockApi({ 'GET /store/bootstrap': ok(bootstrapFixture()), 'GET /store/pages/about': ok(page('about', { builder })) })
    try {
      renderRoutes(storefrontRoutes, '/pages/about?preview=draft')
      expect(await screen.findByText(/Draft preview/)).toBeInTheDocument()
      expect(screen.getByText('Hidden — visitors do not see this')).toBeInTheDocument()
      expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/store/pages/about?preview=draft'))).toBe(true)
    } finally {
      window.history.replaceState(null, '', '/')
    }
  })
})

/* ============================================================================================== */

const MENU_ID = '01a1c9d9-0000-7000-8000-0000000000e1'

function headerPayload(extra: Element[] = []): BuilderPage {
  const doc: BuilderDocument = documentOf([
    elementNode('logo', 'e_logo', { height: 40 }),
    elementNode('menu', 'e_menu', { menu_id: MENU_ID }),
    elementNode('search_box', 'e_search', { placeholder: 'Find fresh food', button_label: 'Go' }),
    elementNode('account_link', 'e_account', { show_label: true }),
    elementNode('wishlist_link', 'e_wish'),
    elementNode('cart_icon', 'e_cart', { show_total: true }),
    ...extra,
  ])
  return payloadOf(doc, {
    key: 'header',
    title: 'Header',
    data: { e_menu: { name: 'Main', items: [menuNode('Fruits', '/category/fruits', { children: [menuNode('Mangoes', '/category/mangoes')] }), menuNode('Offers', '/pages/offers')] } },
  })
}

function footerPayload(): BuilderPage {
  return payloadOf(documentOf([elementNode('copyright', 'e_copy', { text: 'Built with care, {year}' }), elementNode('social_icons', 'e_social')]), { key: 'footer', title: 'Footer' })
}

function renderStore(builder: StorefrontBootstrap['builder'], theme?: Partial<StorefrontBootstrap['theme']>) {
  const base = bootstrapFixture()
  return mockApi({
    'GET /store/bootstrap': ok(bootstrapFixture({ builder, theme: { ...footerTheme(base), ...theme } })),
    'GET /store/pages/about': ok(page('about')),
    'GET /store/cart': ok(cartFixture()),
    'GET /store/wishlist': ok({ items: [] }),
  })
}

describe('builder header and footer', () => {
  it('uses the builder header from 768 px, keeping the sticky setting', async () => {
    viewport(1366)
    renderStore({ home: false, header: headerPayload(), footer: null })
    renderRoutes(storefrontRoutes, '/pages/about')

    const header = await screen.findByTestId('site-header')
    expect(header).toHaveAttribute('data-header-style', 'builder')
    expect(header).toHaveClass('sticky')
    expect(within(header).getByTestId('builder-header')).toBeInTheDocument()
    expect(within(header).getByRole('link', { name: 'Berry Kids home' })).toHaveAttribute('href', '/')
    const nav = within(header).getByRole('navigation', { name: 'Main' })
    expect(within(nav).getByRole('link', { name: 'Fruits' })).toHaveAttribute('href', '/category/fruits')
    expect(within(nav).getByRole('button', { name: /Fruits/ })).toHaveAttribute('aria-expanded', 'false')
    expect(within(header).getByPlaceholderText('Find fresh food')).toBeInTheDocument()
    expect(within(header).getByRole('button', { name: 'Go' })).toBeInTheDocument()
    expect(within(header).getByRole('link', { name: 'Sign in' })).toHaveTextContent('Sign in')
    expect(within(header).getByRole('link', { name: 'Wishlist' })).toBeInTheDocument()
    expect(within(header).getByTestId('cart-total-button')).toBeInTheDocument()
    // The classic header's parts are gone.
    expect(within(header).queryByRole('button', { name: 'Open search' })).toBeNull()
  })

  it('keeps the compact header with its drawer below 768 px', async () => {
    viewport(375)
    renderStore({ home: false, header: headerPayload(), footer: null })
    renderRoutes(storefrontRoutes, '/pages/about')
    const header = await screen.findByTestId('site-header')
    expect(header).not.toHaveAttribute('data-header-style')
    expect(within(header).getByRole('button', { name: 'Open search' })).toBeInTheDocument()
    expect(screen.queryByTestId('builder-header')).toBeNull()
  })

  it('renders exactly the theme header and footer without builder payloads', async () => {
    viewport(1366)
    renderStore({ home: false, header: null, footer: null, zones: {} })
    renderRoutes(storefrontRoutes, '/pages/about')
    const header = await screen.findByTestId('site-header')
    expect(header).not.toHaveAttribute('data-header-style')
    expect(screen.getByTestId('site-footer')).not.toHaveAttribute('data-footer-style')
    expect(screen.queryByTestId('builder-header')).toBeNull()
    expect(screen.queryByTestId('builder-footer')).toBeNull()
  })

  it('replaces the footer at every width', async () => {
    viewport(375)
    renderStore({ home: false, header: null, footer: footerPayload() })
    renderRoutes(storefrontRoutes, '/pages/about')
    const footer = await screen.findByTestId('site-footer')
    expect(footer).toHaveAttribute('data-footer-style', 'builder')
    expect(within(footer).getByTestId('builder-copyright')).toHaveTextContent(`Built with care, ${new Date().getFullYear()}`)
    expect(within(footer).getByRole('link', { name: /Facebook/ })).toBeInTheDocument()
    expect(within(footer).queryByText('Fresh food from local farms.')).toBeNull()
  })

  it('lets a header announcement replace the announcement bar', async () => {
    viewport(1366)
    const announcement = { text: 'Free delivery this week', link: null, background: '#111111', foreground: '#ffffff' }
    renderStore({ home: false, header: headerPayload([elementNode('announcement', 'e_ann')]) }, { announcement })
    renderRoutes(storefrontRoutes, '/pages/about')
    const header = await screen.findByTestId('site-header')
    expect(within(header).getByText('Free delivery this week')).toBeInTheDocument()
    expect(screen.getAllByTestId('announcement-bar')).toHaveLength(1)
  })

  it('keeps the announcement bar when the builder header has none', async () => {
    viewport(1366)
    const announcement = { text: 'Free delivery this week', link: null, background: '#111111', foreground: '#ffffff' }
    renderStore({ home: false, header: headerPayload() }, { announcement })
    renderRoutes(storefrontRoutes, '/pages/about')
    const bar = await screen.findByTestId('announcement-bar')
    expect(bar.closest('[data-testid="site-header"]')).toBeNull()
  })
})

/* ============================================================================================== */

function zone(key: string, text: string): BuilderPage {
  return payloadOf(documentOf([elementNode('heading', `e_${key.replace('.', '_')}`, { text, level: 2 })]), { key: `zone:${key}`, title: key })
}

describe('shop and product zones, products per row', () => {
  it('draws the listing zones around the product grid', async () => {
    mockApi({
      'GET /store/bootstrap': ok(bootstrapFixture({ builder: { home: false, zones: { 'listing.top': zone('listing.top', 'Summer picks'), 'listing.bottom': zone('listing.bottom', 'Need help choosing?'), 'product.after': null } } })),
      'GET /store/products': { body: listingBody([productCard('fresh-spinach'), productCard('organic-carrots')]) },
    })
    renderRoutes(storefrontRoutes, '/shop')
    const results = await screen.findByTestId('product-results')
    const top = screen.getByTestId('builder-zone-listing.top')
    const bottom = screen.getByTestId('builder-zone-listing.bottom')
    expect(within(top).getByRole('heading', { name: 'Summer picks' })).toBeInTheDocument()
    expect(within(bottom).getByRole('heading', { name: 'Need help choosing?' })).toBeInTheDocument()
    expect(top.compareDocumentPosition(results) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(results.compareDocumentPosition(bottom) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // Default products per row: today's classes.
    expect(results).toHaveClass('grid-cols-2', 'md:grid-cols-3', 'lg:grid-cols-3')
    expect(results).toHaveAttribute('data-columns', '3-3-2')
  })

  it('applies the theme’s products per row per device (grid view only)', async () => {
    const base = bootstrapFixture()
    mockApi({
      'GET /store/bootstrap': ok(bootstrapFixture({ theme: { ...base.theme, layout: { ...base.theme.layout, listing_columns: { desktop: 5, tablet: 4, mobile: 1 } } } })),
      'GET /store/products': { body: listingBody([productCard('fresh-spinach')]) },
    })
    const { router } = renderRoutes(storefrontRoutes, '/shop')
    const results = await screen.findByTestId('product-results')
    expect(results).toHaveClass('grid-cols-1', 'md:grid-cols-4', 'lg:grid-cols-5')
    expect(results).not.toHaveClass('grid-cols-2')
    expect(screen.queryByTestId('builder-zone-listing.top')).toBeNull()
    await act(() => router.navigate('/shop?view=list'))
    await waitFor(() => expect(screen.getByTestId('product-results')).toHaveClass('grid-cols-1'))
    expect(screen.getByTestId('product-results')).not.toHaveClass('lg:grid-cols-5')
  })

  it('draws the product zone below the details and tabs', async () => {
    mockApi({
      'GET /store/bootstrap': ok(bootstrapFixture({ builder: { home: false, zones: { 'product.after': zone('product.after', 'Grown by our farmers') } } })),
      'GET /store/products/kids-tee': ok(productDetail()),
      'GET /store/products/kids-tee/related': ok({ related: [], frequently_bought: [] }),
      'GET /store/products/kids-tee/reviews': ok([], { summary: { average: '0.0', count: 0, distribution: {} } }),
    })
    renderRoutes(storefrontRoutes, '/product/kids-tee')
    const zoneEl = await screen.findByTestId('builder-zone-product.after')
    expect(within(zoneEl).getByRole('heading', { name: 'Grown by our farmers' })).toBeInTheDocument()
    const details = screen.getByRole('region', { name: 'Product information' })
    expect(details.compareDocumentPosition(zoneEl) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(zoneEl.closest('[data-testid="product-page"]')).not.toBeNull()
  })
})

/* ============================================================================================== */

type FixtureNode = { id: string; type: string; props?: Record<string, unknown>; columns?: { elements: FixtureNode[] }[] }

function fixtureElements(document: BuilderDocument): FixtureNode[] {
  const out: FixtureNode[] = []
  const walk = (nodes: FixtureNode[]) => {
    for (const node of nodes) {
      if (node.type !== 'section') out.push(node)
      for (const column of node.columns ?? []) walk(column.elements)
    }
  }
  walk(document.sections as unknown as FixtureNode[])
  return out
}

describe('shared B4 fixtures (backend round-trip documents)', () => {
  const menuData = { name: 'Main', items: [menuNode('Fruits', '/category/fruits', { children: [menuNode('Mangoes', '/category/mangoes')] })] }

  it('uses only known types, enum values, icons and video URLs the client accepts', () => {
    for (const doc of [headerFixture, footerFixture, elementsFixture]) {
      for (const node of fixtureElements(doc)) {
        expect(elementMeta(node.type), node.type).toBeDefined()
        const p = node.props ?? {}
        expect(Object.keys(p).sort(), `${node.id} props`).toEqual(Object.keys(elementMeta(node.type)!.props).sort())
        if (node.type === 'icon') expect(ICON_NAMES).toContain(p.name)
        if (node.type === 'video') expect(parseVideoUrl(p.url)).toEqual({ provider: p.provider, video_id: p.video_id })
      }
      expect(fixtureElements(headerFixture).every((node) => isAllowedIn(node.type, 'header'))).toBe(true)
      expect(fixtureElements(footerFixture).every((node) => isAllowedIn(node.type, 'footer'))).toBe(true)
    }
  })

  it('draws every element of the header fixture at 1366 px', async () => {
    viewport(1366)
    const header = payloadOf(headerFixture, { key: 'header', data: { e_main_menu: menuData } })
    renderStore({ home: false, header }, { announcement: { text: 'Free delivery', link: null, background: '#111111', foreground: '#ffffff' } })
    const { container } = renderRoutes(storefrontRoutes, '/pages/about')
    await screen.findByTestId('builder-header')
    const scope = container.querySelector('[data-testid="builder-header"]')!
    for (const node of fixtureElements(headerFixture)) {
      if (node.type === 'language_switch') continue // one-language store: nothing to switch
      expect(scope.querySelector(`[data-b="${node.id}"]`), node.id).not.toBeNull()
    }
  })

  it('draws every element of the footer fixture, in Bangla too', async () => {
    const footer = payloadOf(footerFixture, { key: 'footer', locale: 'bn', data: { e_footer_menu: menuData } })
    mockApi({ 'GET /store/bootstrap': ok(bilingualBootstrap({}, { builder: { home: false, footer }, theme: footerTheme() })), 'GET /store/pages/about': ok(page('about')) })
    const { container } = renderRoutes(storefrontRoutes, '/pages/about')
    const scope = await screen.findByTestId('builder-footer')
    for (const node of fixtureElements(footerFixture)) expect(container.querySelector(`[data-testid="builder-footer"] [data-b="${node.id}"]`), node.id).not.toBeNull()
    expect(within(scope).getByRole('heading', { name: 'কেনাকাটা' })).toBeInTheDocument()
    expect(within(scope).getByRole('heading', { name: 'নিউজলেটারে যোগ দিন' })).toBeInTheDocument()
  })

  it('draws every element of the B4 elements fixture with its data (nested translations included)', async () => {
    const future = new Date(Date.now() + 3 * 86_400_000).toISOString()
    const data: Record<string, BuilderData> = {
      e_countdown: { ends_at: future, promotion: null },
      e_flash: { ends_at: future, promotion: { id: '01a1c9d9-0000-7000-8000-000000000201', name: 'Flash sale' } },
      e_discount: { name: 'Welcome', kind: 'percent', value: '10.00', coupon_code: 'WELCOME10', min_subtotal: null, ends_at: null },
      e_promo: productCard('berry-jam'),
      e_menu: menuData,
      e_footer_menu: menuData,
      e_faq: { groups: [{ group: null, items: [{ id: 'q1', question: 'Is it organic?', answer_html: '<p>Yes.</p>' }] }] },
    }
    const builder = payloadOf(elementsFixture, { key: 'cms:x', locale: 'bn', data })
    const announcement = { text: 'Free delivery', link: null, background: '#111111', foreground: '#ffffff' }
    mockApi({
      'GET /store/bootstrap': ok(bilingualBootstrap({}, { theme: { ...footerTheme(), announcement } })),
      'GET /store/pages/about': ok(page('about', { builder })),
    })
    const { container } = renderRoutes(storefrontRoutes, '/pages/about')
    await screen.findByTestId('builder-cta')
    for (const node of fixtureElements(elementsFixture)) expect(container.querySelector(`[data-b-scope="page"] [data-b="${node.id}"]`), node.id).not.toBeNull()
    expect(screen.getByRole('link', { name: 'কেনাকাটা করুন' })).toHaveAttribute('href', '/shop')
    expect(screen.getByRole('heading', { name: 'আপনি প্রস্তুত হলেই' })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /Play video|ভিডিও চালান/ })).toHaveLength(2)
  })
})
