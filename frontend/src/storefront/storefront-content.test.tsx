import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { fail, mockApi, ok, renderRoutes } from '@/test/utils'
import { storefrontRoutes } from './routes'
import { bootstrapFixture } from './test-fixtures'
import type { StoreBanner, StoreSection } from './types'

const image = { id: 'img-1', url: '/storage/media/o/hero.jpg', srcset: '/storage/media/o/hero-640.webp 640w, /storage/media/o/hero.jpg 1600w', width: 1600, height: 600, alt: null }

const banner = (id: string, overrides: Partial<StoreBanner> = {}): StoreBanner => ({
  id,
  kicker: null,
  title: `Banner ${id}`,
  subtitle: null,
  link_url: null,
  button_label: null,
  secondary_link_url: null,
  secondary_button_label: null,
  image,
  mobile_image: null,
  text_color: '#ffffff',
  text_position: 'left',
  ...overrides,
})

const sections: StoreSection[] = [
  {
    id: 's-1',
    type: 'hero_slider',
    title: null,
    subtitle: null,
    config: { autoplay_seconds: 0, height: 'large' },
    banners: [banner('b-1', { kicker: 'Online', title: 'Flat 20% off', button_label: 'Shop now', link_url: '/pages/sale' }), banner('b-2', { title: 'New arrivals' })],
  },
  { id: 's-2', type: 'features_strip', title: 'Why us', subtitle: null, config: { items: [{ icon: 'truck', title: 'Fast delivery', text: 'Dhaka in 24h' }], background: null } },
  { id: 's-3', type: 'rich_text', title: null, subtitle: null, config: { body_html: '<p>Read <a href="/pages/about">our story</a>.</p>', alignment: 'left', width: 'narrow', background: null } },
  { id: 's-4', type: 'newsletter', title: 'Weekly offers', subtitle: null, config: { text: null, button_label: 'Subscribe', image: null, background: '#c2410c', foreground: '#ffffff' } },
]

describe('storefront homepage', () => {
  it('renders the sections in order with banners, links and the newsletter sign-up', async () => {
    const bodies: unknown[] = []
    mockApi({
      'GET /store/bootstrap': ok(bootstrapFixture()),
      'GET /store/homepage': ok({ sections, preview: false }),
      'POST /store/newsletter': (init) => {
        bodies.push(JSON.parse(String(init.body)))
        return { status: 202, body: { success: true, data: { message: 'Almost done: check your inbox.' }, meta: {} } }
      },
    })
    renderRoutes(storefrontRoutes)
    const user = userEvent.setup()

    const rendered = await screen.findAllByTestId('homepage-section')
    expect(rendered.map((el) => el.dataset.sectionType)).toEqual(['hero_slider', 'features_strip', 'rich_text', 'newsletter'])

    const carousel = screen.getByRole('region', { name: 'Featured' })
    const first = within(carousel).getByRole('group', { name: '1 of 2: Flat 20% off' })
    expect(first).toHaveAttribute('aria-hidden', 'false')
    expect(within(first).getByRole('link', { name: 'Shop now' })).toHaveAttribute('href', '/pages/sale')
    expect(within(carousel).queryByRole('group', { name: '2 of 2: New arrivals' })).not.toBeInTheDocument()
    await user.click(within(carousel).getByRole('button', { name: 'Next slide' }))
    expect(within(carousel).getByRole('group', { name: '2 of 2: New arrivals' })).toHaveAttribute('aria-hidden', 'false')
    // No autoplay configured: no stop button.
    expect(within(carousel).queryByRole('button', { name: /automatic slides/ })).not.toBeInTheDocument()

    expect(screen.getByRole('heading', { name: 'Fast delivery' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'our story' })).toHaveAttribute('href', '/pages/about')

    await user.type(screen.getByLabelText('E-mail address'), 'mina@example.com')
    await user.click(screen.getByRole('button', { name: 'Subscribe' }))
    expect(await screen.findByText('Almost done: check your inbox.')).toHaveAttribute('role', 'status')
    expect(bodies).toEqual([{ email: 'mina@example.com' }])
  })

  it('marks sections visitors do not see in a staff preview', async () => {
    const fetchMock = mockApi({
      'GET /store/bootstrap': ok(bootstrapFixture()),
      'GET /store/homepage': ok({ sections: [{ ...sections[1], state: 'disabled' }, { ...sections[2], state: 'live' }], preview: true }),
    })
    renderRoutes(storefrontRoutes, '/?preview=1')

    expect(await screen.findByText('Hidden — visitors do not see this section')).toBeInTheDocument()
    expect(screen.getByText('Homepage preview — sections visitors do not see are marked.')).toBeInTheDocument()
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toContainEqual(expect.stringContaining('/store/homepage?preview=1'))
  })
})

describe('storefront content pages', () => {
  it('shows a FAQ page with its grouped questions', async () => {
    mockApi({
      'GET /store/bootstrap': ok(bootstrapFixture()),
      'GET /store/pages/faq': ok({
        slug: 'faq',
        title: 'FAQ',
        template: 'faq',
        body_html: '<p>Answers to common questions.</p>',
        published_at: null,
        seo_title: null,
        seo_description: null,
        updated_at: null,
        faq: [{ group: 'Delivery', items: [{ id: 'f-1', question: 'How fast?', answer_html: '<p>Same day.</p>' }] }],
      }),
    })
    renderRoutes(storefrontRoutes, '/pages/faq')
    const user = userEvent.setup()

    expect(await screen.findByRole('heading', { level: 1, name: 'FAQ' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Delivery' })).toBeInTheDocument()
    await user.click(screen.getByText('How fast?'))
    expect(screen.getByText('Same day.')).toBeVisible()
    await waitFor(() => expect(document.title).toBe('FAQ | Berry Kids'))
  })

  it('sends the contact form, validating it first', async () => {
    const bodies: unknown[] = []
    const base = bootstrapFixture()
    mockApi({
      'GET /store/bootstrap': ok({ ...base, theme: { ...base.theme, footer: { ...base.theme.footer, contact: { email: 'hi@berry.test', phone: null, address: null } } } }),
      'GET /store/pages/contact': ok({ slug: 'contact', title: 'Contact us', template: 'contact', body_html: null, published_at: null, seo_title: null, seo_description: null, updated_at: null }),
      'POST /store/contact': (init) => {
        bodies.push(JSON.parse(String(init.body)))
        return { status: 202, body: { success: true, data: { message: 'Thank you. We will get back to you soon.' }, meta: {} } }
      },
    })
    renderRoutes(storefrontRoutes, '/pages/contact')
    const user = userEvent.setup()

    const form = await screen.findByRole('form', { name: 'Contact form' })
    expect(within(screen.getByRole('article')).getByRole('link', { name: 'hi@berry.test' })).toHaveAttribute('href', 'mailto:hi@berry.test')
    await user.click(within(form).getByRole('button', { name: 'Send message' }))
    expect(within(form).getByText('Please enter your name.')).toBeInTheDocument()
    expect(bodies).toHaveLength(0)

    await user.type(within(form).getByLabelText('Your name'), 'Rina')
    await user.type(within(form).getByLabelText('E-mail'), 'rina@example.com')
    await user.type(within(form).getByLabelText('Message'), 'Do you have size 2T?')
    await user.click(within(form).getByRole('button', { name: 'Send message' }))

    expect(await screen.findByText('Thank you. We will get back to you soon.')).toBeInTheDocument()
    expect(bodies).toEqual([{ name: 'Rina', email: 'rina@example.com', message: 'Do you have size 2T?' }])
  })

  it('shows the not-found page for unknown or unpublished pages', async () => {
    mockApi({ 'GET /store/bootstrap': ok(bootstrapFixture()), 'GET /store/pages/secret': fail(404, 'NOT_FOUND', 'This page does not exist.') })
    renderRoutes(storefrontRoutes, '/pages/secret')

    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument()
  })
})

describe('newsletter links', () => {
  it('confirms a subscription from the e-mail link once', async () => {
    const tokens: unknown[] = []
    mockApi({
      'GET /store/bootstrap': ok(bootstrapFixture()),
      'POST /store/newsletter/confirm': (init) => {
        tokens.push(JSON.parse(String(init.body)))
        return ok({ message: 'Your subscription is confirmed.' })
      },
    })
    renderRoutes(storefrontRoutes, '/newsletter/confirm?token=abc')

    expect(await screen.findByRole('heading', { name: 'You are subscribed' })).toBeInTheDocument()
    expect(tokens).toEqual([{ token: 'abc' }])
  })

  it('unsubscribes only after a click', async () => {
    let calls = 0
    mockApi({
      'GET /store/bootstrap': ok(bootstrapFixture()),
      'POST /store/newsletter/unsubscribe': () => {
        calls += 1
        return ok({ message: 'You have been unsubscribed.' })
      },
    })
    renderRoutes(storefrontRoutes, '/newsletter/unsubscribe?token=xyz')
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Unsubscribe' }))
    expect(await screen.findByText('You have been unsubscribed.')).toBeInTheDocument()
    expect(calls).toBe(1)
  })
})
