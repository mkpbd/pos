import { screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { mockApi, ok, renderRoutes } from '@/test/utils'
import { storefrontRoutes } from './routes'
import { bilingualBootstrap, blogPostDetail, blogPostRow, bootstrapFixture, resetLocale } from './test-fixtures'
import type { StoreBanner, StoreSection } from './types'

const image = { id: 'img-1', url: '/storage/media/o/hero.jpg', srcset: '/storage/media/o/hero.jpg 1600w', width: 1600, height: 600, alt: null }

const banner = (id: string, title: string): StoreBanner => ({
  id,
  kicker: null,
  title,
  subtitle: null,
  link_url: null,
  button_label: null,
  secondary_link_url: null,
  secondary_button_label: null,
  image,
  mobile_image: null,
  text_color: '#ffffff',
  text_position: 'left',
})

const sections: StoreSection[] = [
  { id: 's-1', type: 'hero_slider', title: null, subtitle: null, config: { autoplay_seconds: 5, height: 'large' }, banners: [banner('b-1', 'ঈদ অফার'), banner('b-2', 'নতুন কালেকশন')] },
  { id: 's-2', type: 'features_strip', title: null, subtitle: null, config: { items: [{ icon: 'truck', title: 'দ্রুত ডেলিভারি', text: null }], background: null } },
  { id: 's-3', type: 'newsletter', title: null, subtitle: null, config: { text: null, button_label: 'সাবস্ক্রাইব করুন', image: null, background: '#c2410c', foreground: '#ffffff' } },
]

function bangla(store: Parameters<typeof bilingualBootstrap>[0] = {}) {
  const base = bootstrapFixture()
  return bilingualBootstrap(store, { theme: { ...base.theme, footer: { ...base.theme.footer, contact: { email: 'hello@berry.test', phone: null, address: null } } } })
}

afterEach(resetLocale)

describe('storefront content in Bangla', () => {
  it('shows the frame and the homepage sections in Bangla with Latin digits by default', async () => {
    mockApi({ 'GET /store/bootstrap': ok(bangla()), 'GET /store/homepage': ok({ sections, preview: false }) })
    renderRoutes(storefrontRoutes, '/?lang=bn')

    const carousel = await screen.findByRole('region', { name: 'বিশেষ আকর্ষণ' })
    expect(document.documentElement.lang).toBe('bn')
    expect(within(carousel).getByRole('group', { name: '2টির মধ্যে 1: ঈদ অফার' })).toHaveAttribute('aria-hidden', 'false')
    expect(within(carousel).getByRole('button', { name: 'পরের স্লাইড' })).toBeInTheDocument()
    expect(within(carousel).getByRole('button', { name: 'স্বয়ংক্রিয় স্লাইড বন্ধ করুন' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'কেন আমাদের কাছ থেকে কিনবেন' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'নিউজলেটার' })).toBeInTheDocument()
    expect(screen.getByPlaceholderText('আপনার ই-মেইল ঠিকানা')).toBeInTheDocument()
    expect(screen.getByLabelText('ই-মেইল ঠিকানা')).toBeInTheDocument()

    // Header search and footer.
    expect(screen.getAllByPlaceholderText('পণ্য খুঁজুন…').length).toBeGreaterThan(0)
    expect(screen.getByRole('navigation', { name: 'প্রধান মেনু' })).toBeInTheDocument()
    const footer = screen.getByTestId('site-footer')
    expect(within(footer).getByRole('heading', { name: 'যোগাযোগ করুন' })).toBeInTheDocument()
    expect(within(footer).getByText(`© ${new Date().getFullYear()} Berry Kids`)).toBeInTheDocument()
  })

  it('uses Bengali digits when the store turned them on', async () => {
    mockApi({ 'GET /store/bootstrap': ok(bangla({ bangla_digits: true })), 'GET /store/homepage': ok({ sections, preview: false }) })
    renderRoutes(storefrontRoutes, '/?lang=bn')

    const carousel = await screen.findByRole('region', { name: 'বিশেষ আকর্ষণ' })
    expect(within(carousel).getByRole('group', { name: '২টির মধ্যে ১: ঈদ অফার' })).toBeInTheDocument()
    expect(within(carousel).getByRole('button', { name: '২ নম্বর স্লাইডে যান' })).toBeInTheDocument()
    const year = String(new Date().getFullYear()).replace(/\d/g, (d) => '০১২৩৪৫৬৭৮৯'[Number(d)]!)
    expect(within(screen.getByTestId('site-footer')).getByText(`© ${year} Berry Kids`)).toBeInTheDocument()
  })

  it('shows the blog index and a post in Bangla', async () => {
    mockApi({
      'GET /store/bootstrap': ok(bangla()),
      'GET /store/blog/categories': ok([{ slug: 'recipes', name: 'রেসিপি', description: null, post_count: 3 }]),
      'GET /store/blog': ok([blogPostRow('mango-lassi')], { current_page: 1, per_page: 9, total: 1, last_page: 1 }),
      'GET /store/blog/mango-lassi': ok(blogPostDetail('mango-lassi', { category: { name: 'রেসিপি', slug: 'recipes' } })),
    })
    const { router } = renderRoutes(storefrontRoutes, '/blog?lang=bn')

    expect(await screen.findByRole('heading', { level: 1, name: 'ব্লগ' })).toBeInTheDocument()
    await waitFor(() => expect(document.title).toBe('ব্লগ | Berry Kids'))
    const chips = screen.getByRole('navigation', { name: 'ব্লগ ক্যাটাগরি' })
    expect(within(chips).getByRole('link', { name: 'সব পোস্ট' })).toHaveAttribute('aria-current', 'page')
    expect(within(chips).getByRole('link', { name: 'রেসিপি (3)' })).toBeInTheDocument()
    expect(screen.getByRole('list', { name: 'ব্লগ পোস্ট' })).toBeInTheDocument()
    expect(screen.getByText('পড়তে 4 মিনিট')).toBeInTheDocument()

    await router.navigate('/blog/mango-lassi')
    expect(await screen.findByText('লিখেছেন Rina')).toBeInTheDocument()
    expect(screen.getByText(/বিষয়:/)).toHaveTextContent('বিষয়: রেসিপি')
  })

  it('shows the 404 page and the newsletter pages in Bangla', async () => {
    mockApi({ 'GET /store/bootstrap': ok(bangla()) })
    const { router } = renderRoutes(storefrontRoutes, '/nowhere?lang=bn')

    expect(await screen.findByRole('heading', { level: 1, name: 'পেজটি পাওয়া যায়নি' })).toBeInTheDocument()
    await waitFor(() => expect(document.title).toBe('পেজটি পাওয়া যায়নি | Berry Kids'))
    expect(screen.getByRole('link', { name: 'হোম পেজে ফিরে যান' })).toHaveAttribute('href', '/')

    await router.navigate('/newsletter/unsubscribe')
    expect(await screen.findByRole('heading', { level: 1, name: 'আনসাবস্ক্রাইব' })).toBeInTheDocument()
    expect(screen.getByText('লিংকটি অসম্পূর্ণ। অনুগ্রহ করে ই-মেইলে পাঠানো লিংকটি ব্যবহার করুন।')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'কেনাকাটা চালিয়ে যান' })).toHaveAttribute('href', '/')
  })
})
