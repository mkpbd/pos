import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { routes } from '@/app/routes'
import type { BlogPost, CmsPage, FaqItem } from '@/features/content/api'
import type { BrandListingResponse, CategoryListingResponse } from '@/features/online-catalog/api'
import { listingResponse } from '@/features/online-catalog/test-data'
import type { PaymentGateway } from '@/features/online-payments/api'
import type { Product } from '@/features/products/api'
import { promotion, promotionManager } from '@/features/promotions/test-data'
import type { ShippingZone } from '@/features/shipping/api'
import type { Banner, HomepageSection, SectionTypeInfo, StorefrontSettings, ThemeResponse } from '@/features/storefront/api'
import { orderManager } from '@/features/web-orders/test-data'
import { CATALOG_MANAGER_PERMISSIONS, makeCurrentUser } from '@/test/fixtures'
import { fail, mockApi, ok, renderRoutes } from '@/test/utils'

const toastError = vi.hoisted(() => vi.fn())
vi.mock('sonner', async (importOriginal) => {
  const original = await importOriginal<typeof import('sonner')>()
  return { ...original, toast: Object.assign(vi.fn(), { ...original.toast, error: toastError, success: vi.fn(), message: vi.fn() }) }
})

beforeEach(() => toastError.mockReset())

const json = (init: RequestInit) => JSON.parse(String(init.body)) as Record<string, unknown> & { translations?: { bn: Record<string, string> } }
const paged = (items: unknown[]) => ok(items, { pagination: { current_page: 1, per_page: 100, total: items.length, last_page: 1 } })
const emptyMedia = paged([])
const storeManager = () => makeCurrentUser({ permissions: ['storefront.view', 'storefront.manage', 'media.manage', 'cms.manage', 'online_catalog.view', 'online_catalog.manage'] })
const banglaToggle = (scope: HTMLElement = document.body) => within(scope).getByRole('button', { name: /বাংলা \(Bangla\)/ })

describe('Bangla translations in the product listing', () => {
  const product: Product = {
    id: 'p-1', name: 'Mango Juice', description: null, type: 'standard', category: null, brand: null,
    unit: { id: 'u-pcs', name: 'Piece', code: 'pcs', allow_decimal: false }, tax_rate: null,
    track_stock: true, track_batches: false, track_serials: false, max_discount_percent: null, options: [{ name: 'Size', values: ['1L', '2L'] }], is_active: true, archived_at: null,
    variants: [
      { id: 'v-1', sku: 'MJ-1L', name: null, option_values: { Size: '1L' }, purchase_price: '90.00', selling_price: '120.00', wholesale_price: null, reorder_level: '0.000', barcodes: [], is_active: true },
      { id: 'v-2', sku: 'MJ-2L', name: null, option_values: { Size: '2L' }, purchase_price: '110.00', selling_price: '150.00', wholesale_price: null, reorder_level: '0.000', barcodes: [], is_active: true },
    ],
    images: [],
  }

  it('prefills the Bangla texts, sends them and shows a server error on the Bangla name', async () => {
    const user = userEvent.setup()
    const bodies: Record<string, unknown>[] = []
    mockApi({
      'GET /auth/me': ok(makeCurrentUser({ permissions: [...CATALOG_MANAGER_PERMISSIONS, 'online_catalog.view', 'online_catalog.manage'] })),
      'GET /categories': ok([]),
      'GET /brands': ok([]),
      'GET /units': ok([{ id: 'u-pcs', name: 'Piece', code: 'pcs', allow_decimal: false, base_unit_id: null, conversion_factor: null, is_active: true }]),
      'GET /tax-rates': ok([]),
      'GET /attributes': ok([]),
      'GET /products/p-1': ok(product),
      'GET /online-catalog/products/p-1': ok(listingResponse({ translations: { bn: { name: 'আমের জুস', short_description: 'তাজা আম' } } })),
      'PUT /online-catalog/products/p-1': (init) => {
        bodies.push(json(init))
        return bodies.length === 1
          ? fail(422, 'VALIDATION_FAILED', 'Invalid', { 'translations.bn.name': ['The Bangla name may not be longer than 255 characters.'] })
          : ok(listingResponse({ translations: json(init).translations }))
      },
      'PUT /online-catalog/products/p-1/related': ok({ related: [], frequently_bought: [] }),
    })
    renderRoutes(routes, '/products/p-1')

    const form = await screen.findByRole('form', { name: 'Online listing' })
    // Translated already, so the section is open.
    expect(banglaToggle(form)).toHaveAttribute('aria-expanded', 'true')
    const name = within(form).getByLabelText('Product name in Bangla')
    expect(name).toHaveValue('আমের জুস')
    expect(name).toHaveAttribute('placeholder', 'Mango Juice')
    expect(name).toHaveAttribute('lang', 'bn')
    expect(within(form).getByLabelText('Short description in Bangla')).toHaveValue('তাজা আম')
    expect(await within(form).findByRole('textbox', { name: 'Web description in Bangla' })).toHaveAttribute('lang', 'bn')

    await user.clear(within(form).getByLabelText('Short description in Bangla'))
    await user.type(within(form).getByLabelText('SEO title in Bangla'), 'আমের জুস কিনুন')
    await user.click(within(form).getByRole('button', { name: 'Save online listing' }))

    expect(await within(form).findByText('The Bangla name may not be longer than 255 characters.')).toBeInTheDocument()
    expect(within(form).getByLabelText('Product name in Bangla')).toHaveAttribute('aria-invalid', 'true')
    expect(bodies[0]?.translations).toEqual({ bn: { name: 'আমের জুস', short_description: '', description_html: '', seo_title: 'আমের জুস কিনুন', seo_description: '' } })

    await user.clear(within(form).getByLabelText('Product name in Bangla'))
    await user.type(within(form).getByLabelText('Product name in Bangla'), 'আম জুস')
    await user.click(within(form).getByRole('button', { name: 'Save online listing' }))
    await waitFor(() => expect(bodies).toHaveLength(2))
    expect(bodies[1]?.translations).toMatchObject({ bn: { name: 'আম জুস', seo_title: 'আমের জুস কিনুন' } })
  })
})

describe('Bangla translations of web categories and brands', () => {
  it('saves a category and a brand with their Bangla names', async () => {
    const user = userEvent.setup()
    let category: Record<string, unknown> | undefined
    let brand: Record<string, unknown> | undefined
    const categoryListing: CategoryListingResponse = {
      category: { id: 'c-1', name: 'Juices', parent_id: null, is_active: true },
      listing: { exists: true, slug: 'juices', is_visible: true, image_media_id: null, banner_media_id: null, description_html: null, seo_title: null, seo_description: null, translations: { bn: { name: 'জুস' } } },
      url: '/category/juices',
    }
    const brandListing: BrandListingResponse = {
      brand: { id: 'b-1', name: 'Pran', is_active: true },
      listing: { exists: false, slug: 'pran', is_visible: true, logo_media_id: null, description: 'Bangladeshi foods', seo_title: null, seo_description: null, translations: null },
      url: '/brand/pran',
    }
    mockApi({
      'GET /auth/me': ok(storeManager()),
      'GET /online-catalog/categories': ok([{ id: 'c-1', name: 'Juices', parent_id: null, depth: 0, is_active: true, listing: { slug: 'juices', is_visible: true } }]),
      'GET /online-catalog/categories/c-1': ok(categoryListing),
      'PUT /online-catalog/categories/c-1': (init) => {
        category = json(init)
        return ok(categoryListing)
      },
      'GET /online-catalog/brands': ok([{ id: 'b-1', name: 'Pran', is_active: true, listing: null }]),
      'GET /online-catalog/brands/b-1': ok(brandListing),
      'PUT /online-catalog/brands/b-1': (init) => {
        brand = json(init)
        return ok(brandListing)
      },
      'GET /media': emptyMedia,
    })
    const { router } = renderRoutes(routes, '/storefront/categories')

    await user.click(await screen.findByRole('button', { name: 'Edit web listing of Juices' }))
    let dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByLabelText('Category name in Bangla')).toHaveValue('জুস')
    await user.type(within(dialog).getByLabelText('Meta description in Bangla'), 'ঠান্ডা জুস')
    await user.click(within(dialog).getByRole('button', { name: 'Save listing' }))
    await waitFor(() => expect(category?.translations).toEqual({ bn: { name: 'জুস', description_html: '', seo_title: '', seo_description: 'ঠান্ডা জুস' } }))

    await router.navigate('/storefront/brands')
    await user.click(await screen.findByRole('button', { name: 'Edit web listing of Pran' }))
    dialog = await screen.findByRole('dialog')
    // Nothing translated yet: collapsed until opened.
    expect(within(dialog).queryByLabelText('Brand name in Bangla')).not.toBeInTheDocument()
    await user.click(banglaToggle(dialog))
    expect(within(dialog).getByLabelText('Description in Bangla')).toHaveAttribute('placeholder', 'Bangladeshi foods')
    await user.type(within(dialog).getByLabelText('Brand name in Bangla'), 'প্রাণ')
    await user.click(within(dialog).getByRole('button', { name: 'Save listing' }))
    await waitFor(() => expect(brand?.translations).toEqual({ bn: { name: 'প্রাণ', description: '', seo_title: '', seo_description: '' } }))
  })
})

describe('Bangla translations of content', () => {
  const page = (overrides: Partial<CmsPage> = {}): CmsPage => ({
    id: 'p-1', slug: 'about-us', title: 'About us', template: 'default', status: 'published', is_visible: true, published_at: null,
    seo_title: null, seo_description: null, updated_at: null, body_html: '<p>Hello</p>', translations: { bn: { title: 'আমাদের কথা', body_html: '<p>নমস্কার</p>' } }, ...overrides,
  })

  it('edits a page’s Bangla title and maps the server error to it', async () => {
    const user = userEvent.setup()
    const bodies: Record<string, unknown>[] = []
    mockApi({
      'GET /auth/me': ok(storeManager()),
      'GET /cms/pages/p-1': ok(page()),
      'PATCH /cms/pages/p-1': (init) => {
        bodies.push(json(init))
        return bodies.length === 1 ? fail(422, 'VALIDATION_FAILED', 'Invalid', { 'translations.bn.title': ['The Bangla title is too long.'] }) : ok(page())
      },
    })
    renderRoutes(routes, '/content/pages/p-1')

    const title = await screen.findByLabelText('Title in Bangla')
    expect(title).toHaveValue('আমাদের কথা')
    expect(title).toHaveAttribute('placeholder', 'About us')
    const body = await screen.findByRole('textbox', { name: 'Page text in Bangla' })
    expect(body).toHaveAttribute('lang', 'bn')
    expect(body).toHaveTextContent('নমস্কার')

    await user.type(screen.getByLabelText('SEO title in Bangla'), 'আমাদের সম্পর্কে')
    await user.click(screen.getByRole('button', { name: 'Save page' }))
    expect(await screen.findByText('The Bangla title is too long.')).toBeInTheDocument()
    expect(screen.getByLabelText('Title in Bangla')).toHaveAttribute('aria-invalid', 'true')
    expect(bodies[0]?.translations).toEqual({ bn: { title: 'আমাদের কথা', body_html: '<p>নমস্কার</p>', seo_title: 'আমাদের সম্পর্কে', seo_description: '' } })
  })

  it('edits FAQ entries in Bangla', async () => {
    const user = userEvent.setup()
    let saved: Record<string, unknown> | undefined
    const item: FaqItem = { id: 'f-1', group: null, question: 'How fast?', answer_html: '<p>Same day</p>', is_active: true, sort_order: 0, translations: null }
    mockApi({
      'GET /auth/me': ok(storeManager()),
      'GET /cms/faq': ok([item]),
      'PATCH /cms/faq/f-1': (init) => {
        saved = json(init)
        return ok(item)
      },
    })
    renderRoutes(routes, '/content/faq')

    await user.click(await screen.findByRole('button', { name: 'Edit "How fast?"' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(banglaToggle(dialog))
    await user.type(within(dialog).getByLabelText('Question in Bangla'), 'কত দ্রুত?')
    expect(await within(dialog).findByRole('textbox', { name: 'Answer in Bangla' })).toHaveAttribute('lang', 'bn')
    expect(within(dialog).getByText('Same day', { selector: '.italic' })).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Save entry' }))
    await waitFor(() => expect(saved?.translations).toEqual({ bn: { question: 'কত দ্রুত?', answer_html: '' } }))
  })

  it('prefills and saves a blog post’s Bangla texts', async () => {
    const user = userEvent.setup()
    let saved: Record<string, unknown> | undefined
    const post: BlogPost = {
      id: 'bp-1', slug: 'eid-desserts', title: 'Eid desserts', excerpt: 'Sweet ideas', status: 'draft', state: 'draft', published_at: null,
      category: null, category_id: null, author: null, cover_media_id: null, cover: null, reading_minutes: 3, updated_at: null,
      body_html: '<p>Hello</p>', seo_title: null, seo_description: null, translations: { bn: { title: 'ঈদের মিষ্টি', excerpt: 'মিষ্টি আইডিয়া' } },
    }
    mockApi({
      'GET /auth/me': ok(storeManager()),
      'GET /cms/blog-categories': ok([]),
      'GET /cms/blog-posts/bp-1': ok(post),
      'PATCH /cms/blog-posts/bp-1': (init) => {
        saved = json(init)
        return ok(post)
      },
    })
    renderRoutes(routes, '/content/blog/bp-1')

    expect(await screen.findByLabelText('Title in Bangla')).toHaveValue('ঈদের মিষ্টি')
    expect(screen.getByLabelText('Excerpt in Bangla')).toHaveAttribute('placeholder', 'Sweet ideas')
    expect(await screen.findByRole('textbox', { name: 'Post text in Bangla' })).toBeInTheDocument()
    await user.clear(screen.getByLabelText('Excerpt in Bangla'))
    await user.type(screen.getByLabelText('Excerpt in Bangla'), 'নতুন')
    await user.click(screen.getByRole('button', { name: 'Save draft' }))
    await waitFor(() => expect(saved?.translations).toEqual({ bn: { title: 'ঈদের মিষ্টি', excerpt: 'নতুন', body_html: '', seo_title: '', seo_description: '' } }))
  })

  it('checks Bangla lengths of a blog category before saving', async () => {
    const user = userEvent.setup()
    let saved: Record<string, unknown> | undefined
    mockApi({
      'GET /auth/me': ok(storeManager()),
      'GET /cms/blog-posts': paged([]),
      'GET /cms/blog-categories': ok([{ id: 'bc-1', name: 'Recipes', slug: 'recipes', description: null, sort_order: 0, translations: { bn: { name: 'রেসিপি' } } }]),
      'PATCH /cms/blog-categories/bc-1': (init) => {
        saved = json(init)
        return ok({ id: 'bc-1', name: 'Recipes', slug: 'recipes', description: null, sort_order: 0 })
      },
    })
    renderRoutes(routes, '/content/blog')

    await user.click(await screen.findByRole('button', { name: 'Categories' }))
    const dialog = await screen.findByRole('dialog', { name: 'Blog categories' })
    await user.click(within(dialog).getByRole('button', { name: 'Edit Recipes' }))
    expect(within(dialog).getByLabelText('Category name in Bangla')).toHaveValue('রেসিপি')
    await user.type(within(dialog).getByLabelText('Description in Bangla'), 'রান্না')
    await user.click(within(dialog).getByRole('button', { name: 'Save category' }))
    await waitFor(() => expect(saved?.translations).toEqual({ bn: { name: 'রেসিপি', description: 'রান্না' } }))
  })
})

describe('Bangla translations of the online store', () => {
  it('saves a menu item’s Bangla label and shows its server error', async () => {
    const user = userEvent.setup()
    let saved: { items: Record<string, unknown>[] } | undefined
    const menu = { id: 'm-1', name: 'Main', location: 'main', location_label: 'Main navigation', is_active: true, updated_at: null }
    const item = { id: 'i-1', type: 'custom', label: 'Boys', url: '/boys', target_id: null, open_in_new_tab: false, is_visible: true, is_mega: false, mega_columns: null, image_media_id: null, translations: { bn: { label: 'ছেলেদের' } }, children: [] }
    mockApi({
      'GET /auth/me': ok(storeManager()),
      'GET /storefront/menus': ok([menu]),
      'GET /storefront/menus/m-1': ok({ ...menu, items: [item] }),
      'GET /storefront/link-targets': ok({ pages: [] }),
      'PUT /storefront/menus/m-1/items': (init) => {
        saved = json(init) as unknown as { items: Record<string, unknown>[] }
        return fail(422, 'VALIDATION_FAILED', 'Invalid', { 'items.0.translations.bn.label': ['The Bangla label is too long.'] })
      },
      'GET /media': emptyMedia,
    })
    renderRoutes(routes, '/storefront/menus?menu=m-1')

    const bn = await screen.findByRole('textbox', { name: 'Item 1 Bangla label' })
    expect(bn).toHaveValue('ছেলেদের')
    expect(bn).toHaveAttribute('lang', 'bn')
    await user.clear(bn)
    await user.type(bn, 'ছেলে')
    await user.click(screen.getByRole('button', { name: 'Save items' }))

    await waitFor(() => expect(saved?.items[0]).toMatchObject({ label: 'Boys', translations: { bn: { label: 'ছেলে' } } }))
    expect(await screen.findByText('The Bangla label is too long.')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Item 1 Bangla label' })).toHaveAttribute('aria-invalid', 'true')
  })

  const banner: Banner = {
    id: 'b-1', placement: 'hero_slider', name: 'Eid sale', kicker: 'New', title: 'Flat 20% off', subtitle: null, link_url: '/sale', button_label: 'Shop now',
    secondary_link_url: null, secondary_button_label: null, desktop_media_id: 'media-1', mobile_media_id: null, text_color: '#ffffff', text_position: 'left',
    starts_at: null, ends_at: null, is_active: true, is_live: true, state: 'live', sort_order: 0, updated_at: null, translations: { bn: { title: 'ফ্ল্যাট ২০% ছাড়' } },
  }

  it('saves a banner’s Bangla texts', async () => {
    const user = userEvent.setup()
    let saved: Record<string, unknown> | undefined
    mockApi({
      'GET /auth/me': ok(storeManager()),
      'GET /storefront/banners': ok([banner]),
      'GET /media': emptyMedia,
      'PATCH /storefront/banners/b-1': (init) => {
        saved = json(init)
        return ok(banner)
      },
    })
    renderRoutes(routes, '/storefront/banners')

    await user.click(await screen.findByRole('button', { name: 'Edit Eid sale' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit banner' })
    expect(within(dialog).getByLabelText('Headline in Bangla')).toHaveValue('ফ্ল্যাট ২০% ছাড়')
    expect(within(dialog).getByLabelText('Button label in Bangla')).toHaveAttribute('placeholder', 'Shop now')
    // Hero slides have a second button.
    expect(within(dialog).getByLabelText('Second button label in Bangla')).toBeInTheDocument()
    await user.type(within(dialog).getByLabelText('Button label in Bangla'), 'এখনই কিনুন')
    await user.click(within(dialog).getByRole('button', { name: 'Save banner' }))
    await waitFor(() =>
      expect(saved?.translations).toEqual({ bn: { kicker: '', title: 'ফ্ল্যাট ২০% ছাড়', subtitle: '', button_label: 'এখনই কিনুন', secondary_button_label: '' } }),
    )
  })

  it('translates a homepage section’s title and newsletter texts', async () => {
    const user = userEvent.setup()
    let saved: Record<string, unknown> | undefined
    const types: SectionTypeInfo[] = [
      { type: 'rich_text', label: 'Text block', description: 'Formatted text.', banner_placement: null, items: null, defaults: { body_html: '', alignment: 'left', width: 'narrow', background: null } },
      { type: 'newsletter', label: 'Newsletter sign-up', description: 'E-mail form.', banner_placement: null, items: null, defaults: { text: null, button_label: 'Subscribe', image_media_id: null, background: '#c2410c', foreground: '#ffffff' } },
    ]
    const section: HomepageSection = {
      id: 's-1', type: 'newsletter', type_label: 'Newsletter sign-up', title: 'Join us', subtitle: null,
      config: { text: 'Deals every week', button_label: 'Subscribe', image_media_id: null, background: '#c2410c', foreground: '#ffffff' },
      banner_ids: [], is_enabled: true, starts_at: null, ends_at: null, state: 'live', sort_order: 0, updated_at: null, translations: { bn: { title: 'যোগ দিন' } },
    }
    mockApi({
      'GET /auth/me': ok(storeManager()),
      'GET /storefront/homepage-sections/types': ok(types),
      'GET /storefront/homepage-sections': ok([section]),
      'GET /storefront/banners': ok([]),
      'GET /media': emptyMedia,
      'PATCH /storefront/homepage-sections/s-1': (init) => {
        saved = json(init)
        return ok(section)
      },
    })
    renderRoutes(routes, '/storefront/homepage')

    await user.click(await screen.findByRole('button', { name: 'Edit Join us' }))
    let dialog = await screen.findByRole('dialog', { name: 'Edit newsletter sign-up' })
    expect(within(dialog).getByLabelText('Title in Bangla')).toHaveValue('যোগ দিন')
    expect(within(dialog).getByLabelText('Newsletter text in Bangla')).toHaveAttribute('placeholder', 'Deals every week')
    await user.type(within(dialog).getByLabelText('Button label in Bangla'), 'সাবস্ক্রাইব')
    await user.click(within(dialog).getByRole('button', { name: 'Save section' }))
    await waitFor(() => expect(saved?.translations).toEqual({ bn: { title: 'যোগ দিন', subtitle: '', text: '', button_label: 'সাবস্ক্রাইব' } }))

    // A text block translates its rich text with the same editor.
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'Add section' }))
    await user.click(await screen.findByRole('button', { name: /Text block/ }))
    dialog = await screen.findByRole('dialog', { name: 'New text block' })
    await user.click(banglaToggle(dialog))
    expect(await within(dialog).findByRole('textbox', { name: 'Section text in Bangla' })).toHaveAttribute('lang', 'bn')
    expect(within(dialog).queryByLabelText('Newsletter text in Bangla')).not.toBeInTheDocument()
  })

  it('saves the announcement’s Bangla text with the theme', async () => {
    const user = userEvent.setup()
    let saved: Record<string, unknown> | undefined
    const theme: ThemeResponse = {
      settings: {
        colors: { primary: '#f59e0b', primary_foreground: '#3b2500', accent: '#6f55c2', accent_foreground: '#ffffff', highlight: '#2fb79a', sale: '#c2410c', heading: '#3d3d3d', text: '#5f6368', canvas: '#f3f7fa', surface: '#ffffff', border: '#e1e1e1' },
        typography: { heading_font: 'baloo', body_font: 'poppins' },
        shape: { button_style: 'pill', card_radius: 12 },
        layout: { container_width: 1170, sticky_header: true },
        logo_media_id: null,
        favicon_media_id: null,
        announcement: { enabled: true, text: 'Free delivery over ৳2000', link: null, background: '#6f55c2', foreground: '#ffffff', starts_at: null, ends_at: null },
        footer: { about: null, copyright: null, contact: { email: null, phone: null, address: null }, social: { facebook: null, instagram: null, youtube: null, tiktok: null, x: null, linkedin: null }, payment_logo_media_ids: [] },
      },
      custom_css: null,
      has_custom_css: false,
      updated_at: null,
    }
    mockApi({
      'GET /auth/me': ok(storeManager()),
      'GET /storefront/theme': ok(theme),
      'GET /media': emptyMedia,
      'PUT /storefront/theme': (init) => {
        saved = json(init)
        return ok({ ...theme, settings: saved })
      },
    })
    renderRoutes(routes, '/storefront/theme')

    await user.click(await screen.findByRole('button', { name: /বাংলা \(Bangla\)/ }))
    const bn = screen.getByLabelText('Announcement text in Bangla')
    expect(bn).toHaveAttribute('placeholder', 'Free delivery over ৳2000')
    await user.type(bn, '৳২০০০ এর বেশি কেনাকাটায় ফ্রি ডেলিভারি')
    await user.click(screen.getByRole('button', { name: 'Save theme' }))
    await waitFor(() => expect((saved?.announcement as { translations?: unknown } | undefined)?.translations).toEqual({ bn: { text: '৳২০০০ এর বেশি কেনাকাটায় ফ্রি ডেলিভারি' } }))
  })
})

describe('Bangla translations at checkout', () => {
  const zone = (): ShippingZone => ({
    id: 'z-1', name: 'Inside Dhaka', is_active: true, sort_order: 0, districts: [{ id: 26, name: 'Dhaka' }],
    methods: [{ id: 'sm-1', zone_id: 'z-1', name: 'Home delivery', description: 'To your door', fee: '60.00', free_over: null, cod_allowed: true, cod_fee: '0.00', eta_min_days: 1, eta_max_days: 2, is_active: true, sort_order: 0, translations: { bn: { name: 'হোম ডেলিভারি' } } }],
  })

  it('saves a shipping method’s Bangla name and description', async () => {
    const user = userEvent.setup()
    const bodies: Record<string, unknown>[] = []
    mockApi({
      'GET /auth/me': ok(orderManager()),
      'GET /shipping/zones': ok([zone()]),
      'GET /geography/divisions': ok([]),
      'GET /geography/districts': ok([]),
      'PATCH /shipping/methods/sm-1': (init) => {
        bodies.push(json(init))
        return bodies.length === 1 ? fail(422, 'VALIDATION_FAILED', 'Invalid', { 'translations.bn.description': ['Too long.'] }) : ok(zone().methods[0])
      },
    })
    renderRoutes(routes, '/storefront/shipping')

    await user.click(await screen.findByRole('button', { name: 'Edit Home delivery' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit Home delivery' })
    expect(within(dialog).getByLabelText('Name in Bangla')).toHaveValue('হোম ডেলিভারি')
    expect(within(dialog).getByLabelText('Description in Bangla')).toHaveAttribute('placeholder', 'To your door')
    await user.type(within(dialog).getByLabelText('Description in Bangla'), 'আপনার দরজায়')
    await user.click(within(dialog).getByRole('button', { name: 'Save method' }))

    expect(await within(dialog).findByText('Too long.')).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Description in Bangla')).toHaveAttribute('aria-invalid', 'true')
    expect(toastError).toHaveBeenCalledWith('Please correct the highlighted Bangla fields.')
    expect(bodies[0]?.translations).toEqual({ bn: { name: 'হোম ডেলিভারি', description: 'আপনার দরজায়' } })
  })

  it('saves a payment method’s Bangla name and instructions', async () => {
    const user = userEvent.setup()
    let saved: Record<string, unknown> | undefined
    const gateways: PaymentGateway[] = [
      { code: 'cod', display_name: 'Cash on delivery', is_enabled: true, instructions: 'Keep the exact amount ready.', settings: { max_order_total: null }, sort_order: 0, translations: { bn: { display_name: 'ক্যাশ অন ডেলিভারি' } } },
      { code: 'bank_transfer', display_name: 'Bank transfer', is_enabled: false, instructions: null, settings: { hold_hours: 48 }, sort_order: 1 },
    ]
    mockApi({
      'GET /auth/me': ok(orderManager()),
      'GET /payment-gateways': ok(gateways),
      'PUT /payment-gateways/cod': (init) => {
        saved = json(init)
        return ok({ ...gateways[0], ...saved })
      },
    })
    renderRoutes(routes, '/storefront/payments')

    const cod = await screen.findByRole('form', { name: 'Cash on delivery settings' })
    expect(within(cod).getByLabelText('Name at checkout in Bangla')).toHaveValue('ক্যাশ অন ডেলিভারি')
    expect(within(cod).getByLabelText('Instructions in Bangla')).toHaveAttribute('placeholder', 'Keep the exact amount ready.')
    await user.type(within(cod).getByLabelText('Instructions in Bangla'), 'সঠিক টাকা রাখুন।')
    await user.click(within(cod).getByRole('button', { name: 'Save cash on delivery' }))
    await waitFor(() => expect(saved?.translations).toEqual({ bn: { display_name: 'ক্যাশ অন ডেলিভারি', instructions: 'সঠিক টাকা রাখুন।' } }))
  })

  it('saves a promotion’s Bangla name and keeps its server error on the Bangla field', async () => {
    const user = userEvent.setup()
    const bodies: Record<string, unknown>[] = []
    mockApi({
      'GET /auth/me': ok(promotionManager()),
      'GET /notifications/unread-count': ok({ count: 0 }),
      'GET /promotions/pr-1': ok(promotion({ translations: { bn: { name: 'জুস সপ্তাহ' } } })),
      'GET /promotions/pr-1/redemptions': paged([]),
      'PATCH /promotions/pr-1': (init) => {
        bodies.push(json(init))
        return fail(422, 'VALIDATION_FAILED', 'Invalid', { 'translations.bn.description': ['The Bangla description is too long.'] })
      },
    })
    renderRoutes(routes, '/promotions/pr-1')

    const name = await screen.findByLabelText('Name in Bangla')
    expect(name).toHaveValue('জুস সপ্তাহ')
    expect(name).toHaveAttribute('placeholder', 'Juice week')
    await user.type(screen.getByLabelText('Description in Bangla'), 'প্রাণ জুসে ১০% ছাড়')
    await user.click(screen.getByRole('button', { name: 'Save promotion' }))

    expect(await screen.findByText('The Bangla description is too long.')).toBeInTheDocument()
    expect(screen.getByLabelText('Description in Bangla')).toHaveAttribute('aria-invalid', 'true')
    // Shown at the field, not repeated in the list of other errors.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(bodies[0]?.translations).toEqual({ bn: { name: 'জুস সপ্তাহ', description: 'প্রাণ জুসে ১০% ছাড়' } })
  })
})

describe('store languages', () => {
  const settings = (overrides: Partial<StorefrontSettings> = {}): StorefrontSettings => ({
    is_enabled: true, site_name: 'Berry Kids', meta_description: null, fulfilment_store_id: null, updated_at: null,
    bangla_enabled: true, default_locale: 'bn', bangla_digits: false, ...overrides,
  })

  it('switches Bangla off (moving the default to English), on again and turns on Bengali digits', async () => {
    const user = userEvent.setup()
    let current = settings()
    const patches: unknown[] = []
    mockApi({
      'GET /auth/me': ok(storeManager()),
      'GET /storefront/settings': () => ok(current),
      'GET /storefront/domains': ok([]),
      'GET /branches': paged([]),
      'PATCH /storefront/settings': (init) => {
        const body = json(init)
        patches.push(body)
        current = { ...current, ...body }
        return ok(current)
      },
    })
    renderRoutes(routes, '/storefront')

    const card = (await screen.findByText('Languages', { selector: '[data-slot="card-title"]' })).closest('[data-slot="card"]') as HTMLElement
    const bangla = within(card).getByRole('switch', { name: 'Offer the store in Bangla' })
    const select = within(card).getByRole('combobox', { name: 'Default language' })
    expect(bangla).toBeChecked()
    expect(select).toHaveTextContent('বাংলা (Bangla)')

    await user.click(bangla)
    await waitFor(() => expect(patches[0]).toEqual({ bangla_enabled: false, default_locale: 'en' }))
    await waitFor(() => expect(select).toHaveTextContent('English'))
    expect(within(card).getByRole('switch', { name: 'Bengali digits in Bangla' })).toBeDisabled()
    await user.click(select)
    expect(await screen.findByRole('option', { name: 'বাংলা (Bangla)' })).toHaveAttribute('aria-disabled', 'true')
    await user.keyboard('{Escape}')

    await user.click(bangla)
    await waitFor(() => expect(patches[1]).toEqual({ bangla_enabled: true }))
    const digits = within(card).getByRole('switch', { name: 'Bengali digits in Bangla' })
    await waitFor(() => expect(digits).toBeEnabled())
    await user.click(digits)
    await waitFor(() => expect(patches[2]).toEqual({ bangla_digits: true }))

    await user.click(select)
    await user.click(await screen.findByRole('option', { name: 'বাংলা (Bangla)' }))
    await waitFor(() => expect(patches[3]).toEqual({ default_locale: 'bn' }))
  })

  it('is read-only without storefront.manage', async () => {
    mockApi({
      'GET /auth/me': ok(makeCurrentUser({ permissions: ['storefront.view'] })),
      'GET /storefront/settings': ok(settings({ default_locale: 'en' })),
      'GET /storefront/domains': ok([]),
      'GET /branches': paged([]),
    })
    renderRoutes(routes, '/storefront')

    expect(await screen.findByRole('switch', { name: 'Offer the store in Bangla' })).toBeDisabled()
    expect(screen.getByRole('combobox', { name: 'Default language' })).toBeDisabled()
    expect(screen.getByRole('switch', { name: 'Bengali digits in Bangla' })).toBeDisabled()
  })
})
