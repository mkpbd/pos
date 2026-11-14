import { expect, test, type Page, type Request, type Route } from '@playwright/test'

/**
 * P1b admin against a mocked API (desktop and phone): the product listing's video link (checked
 * while typing, previewed only on request) and custom badges with Bangla; shoppers' questions
 * (answer and publish, save without publishing, reject, delete after confirmation, filters in the
 * address); the Theme page's product page layout saved with the draft (listing columns kept).
 */

const envelope = (data: unknown, meta: Record<string, unknown> = {}) => ({ success: true, data, meta: { request_id: 'e2e', ...meta } })
const page1 = (items: unknown[], meta: Record<string, unknown> = {}) => envelope(items, { pagination: { current_page: 1, per_page: 25, total: items.length, last_page: 1 }, ...meta })

const user = (permissions: string[]) => ({
  user: { id: 'u-1', name: 'Nadia Admin', email: 'nadia@berry.test', phone: null, is_platform_admin: false, last_login_at: null },
  organization: { id: 'o-1', name: 'Berry Kids', slug: 'berry-kids', base_currency: 'BDT', timezone: 'Asia/Dhaka', tax_mode: 'exclusive', status: 'active' },
  roles: [{ id: 'r-1', name: 'Online Store Manager', system_key: 'online_store_manager' }],
  permissions,
  branches: [{ id: 'b-1', code: 'MAIN', name: 'Main Branch', is_active: true }],
})

const MANAGER = ['branches.view', 'products.view', 'online_catalog.view', 'online_catalog.manage', 'storefront.view', 'storefront.manage', 'storefront.publish', 'reviews.view', 'reviews.moderate', 'media.manage']

const colors = { primary: '#f59e0b', primary_foreground: '#3b2500', accent: '#6f55c2', accent_foreground: '#ffffff', highlight: '#2fb79a', sale: '#c2410c', heading: '#3d3d3d', text: '#5f6368', canvas: '#f3f7fa', surface: '#ffffff', border: '#e1e1e1' }

async function mockShell(page: Page, permissions: string[]) {
  await page.route('**/sanctum/csrf-cookie', (route) => route.fulfill({ status: 204, headers: { 'Set-Cookie': 'XSRF-TOKEN=e2e; Path=/' } }))
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({ json: envelope(user(permissions)) }))
  await page.route('**/api/v1/branches?*', (route) => route.fulfill({ json: page1([]) }))
  await page.route('**/api/v1/notifications/unread-count', (route) => route.fulfill({ json: envelope({ count: 0 }) }))
  await page.route('**/api/v1/media?*', (route) => route.fulfill({ json: page1([]) }))
}

/** No horizontal page scroll (phones included). */
async function expectNoHorizontalOverflow(page: Page) {
  expect(await page.evaluate<number>('document.documentElement.scrollWidth - document.documentElement.clientWidth')).toBeLessThanOrEqual(0)
}

/* ------------------------------------------------------------------------------------------------
 * Product listing: video and badges
 * ---------------------------------------------------------------------------------------------- */

const listing = {
  product: {
    id: 'p-1', name: 'Mango Juice', category_id: null, brand_id: null, is_active: true, options: null,
    images: [{ id: 'img-1', url: '/favicon.svg' }],
    variants: [{ id: 'v-1', sku: 'MJ-1L', name: null, option_values: {}, selling_price: '120.00', is_active: true }],
  },
  listing: {
    exists: true, slug: 'mango-juice', is_published: true, published_at: null, unpublished_at: null, is_featured: false, is_new_until: null,
    short_description: null, description_html: null, specifications: [], seo_title: null, seo_description: null, sort_weight: 0, state: 'live',
    translations: { bn: {} }, video_url: null, badges: [],
  },
  variants: [],
  related: { related: [], frequently_bought: [] },
  url: '/product/mango-juice',
}

test('checks and previews the product video, adds two badges with Bangla and saves', async ({ page }) => {
  await mockShell(page, MANAGER)
  await page.route('**/api/v1/storefront/theme', (route) => route.fulfill({ json: envelope({ settings: { colors }, custom_css: null, has_custom_css: false, updated_at: null }) }))
  await page.route('**/api/v1/online-catalog/products/p-1', (route) => {
    if (route.request().method() !== 'PUT') return route.fulfill({ json: envelope(listing) })
    const body = route.request().postDataJSON() as { video_url: string | null; badges: unknown[] }
    return route.fulfill({ json: envelope({ ...listing, listing: { ...listing.listing, video_url: body.video_url, badges: body.badges } }) })
  })
  await page.route('**/api/v1/online-catalog/products/p-1/related', (route) => route.fulfill({ json: envelope({ related: [], frequently_bought: [] }) }))
  // Nothing may load from YouTube or Vimeo before the owner asks for the preview.
  const videoRequests: string[] = []
  await page.route(/^https:\/\/(www\.youtube-nocookie\.com|player\.vimeo\.com|(www\.)?youtube\.com|i\.ytimg\.com)\//, (route) => {
    videoRequests.push(route.request().url())
    return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>player</title><p>player</p>' })
  })

  await page.goto('/admin/products/p-1/online-store')
  const form = page.getByRole('form', { name: 'Online listing' })
  const video = form.getByLabel('Video link (optional)')
  await video.fill('https://www.youtube.com/@mangoshop')
  await expect(form.getByTestId('video-not-detected')).toContainText('This isn’t a video link yet.')
  await expect(form.getByRole('button', { name: 'Preview video' })).toHaveCount(0)

  await video.fill('https://youtu.be/dQw4w9WgXcQ')
  await expect(form.getByTestId('video-detected')).toHaveText('YouTube video found (dQw4w9WgXcQ).')
  await expect(form.locator('iframe')).toHaveCount(0)
  expect(videoRequests).toEqual([])
  await form.getByRole('button', { name: 'Preview video' }).click()
  const player = form.getByTitle('Product video preview')
  await expect(player).toBeVisible()
  await expect(player).toHaveAttribute('src', /^https:\/\/www\.youtube-nocookie\.com\/embed\/dQw4w9WgXcQ\?/)
  await expect.poll(() => videoRequests.length).toBeGreaterThan(0)
  await form.getByRole('button', { name: 'Close preview' }).click()
  await expect(form.locator('iframe')).toHaveCount(0)

  await form.getByRole('button', { name: 'Add badge' }).click()
  await form.getByLabel('Badge 1 text', { exact: true }).fill('Free gift')
  await form.getByRole('textbox', { name: 'Badge 1 text in Bangla' }).fill('ফ্রি উপহার')
  await expect(form.getByRole('combobox', { name: 'Badge 1 colour' })).toContainText('Secondary colour')
  // The preview uses the store's secondary colour with readable white text.
  await expect(form.getByTestId('badge-preview').first()).toHaveCSS('background-color', 'rgb(111, 85, 194)')
  await expect(form.getByTestId('badge-preview').first()).toHaveCSS('color', 'rgb(255, 255, 255)')
  await form.getByRole('button', { name: 'Add badge' }).click()
  await form.getByLabel('Badge 2 text', { exact: true }).fill('Eid deal')
  await form.getByRole('combobox', { name: 'Badge 2 colour' }).click()
  await page.getByRole('option', { name: 'Sale colour' }).click()
  await expect(form.getByRole('button', { name: 'Add badge' })).toHaveCount(0)
  await expectNoHorizontalOverflow(page)

  const put = page.waitForRequest((r: Request) => r.url().endsWith('/api/v1/online-catalog/products/p-1') && r.method() === 'PUT')
  await form.getByRole('button', { name: 'Save online listing' }).click()
  const body = (await put).postDataJSON() as { video_url: string | null; badges: unknown[] }
  expect(body.video_url).toBe('https://youtu.be/dQw4w9WgXcQ')
  expect(body.badges).toEqual([
    { text: 'Free gift', tone: 'info', translations: { bn: { text: 'ফ্রি উপহার' } } },
    { text: 'Eid deal', tone: 'sale', translations: { bn: { text: '' } } },
  ])
  await expect(page.getByText('Online listing saved.')).toBeVisible()
})

/* ------------------------------------------------------------------------------------------------
 * Questions
 * ---------------------------------------------------------------------------------------------- */

type Question = {
  id: string
  product: { id: string; name: string; slug: string | null }
  name: string
  email: string
  question: string
  answer: string | null
  status: 'pending' | 'published' | 'rejected'
  locale: string
  created_at: string
  answered_at: string | null
  answered_by_name: string | null
}

const base = { answer: null, status: 'pending' as const, locale: 'en', answered_at: null, answered_by_name: null }
const seedQuestions = (): Question[] => [
  { ...base, id: 'q-1', product: { id: 'p-1', name: 'Pran Mango Juice 1L', slug: 'pran-mango-juice-1l' }, name: 'Rina Akter', email: 'rina@example.com', question: 'Is it made with real mangoes?', created_at: '2026-11-12T04:30:00Z' },
  { ...base, id: 'q-2', product: { id: 'p-2', name: 'Baby Romper', slug: 'baby-romper' }, name: 'Karim Ali', email: 'karim@example.com', question: 'আকার কত বড়?', locale: 'bn', created_at: '2026-11-11T04:30:00Z' },
  { ...base, id: 'q-3', product: { id: 'p-2', name: 'Baby Romper', slug: 'baby-romper' }, name: 'Sumi Akter', email: 'sumi@example.com', question: 'Visit my shop for cheaper rompers!', created_at: '2026-11-10T04:30:00Z' },
]

async function mockQuestions(page: Page, permissions: string[], store: Question[]) {
  await mockShell(page, permissions)
  await page.route((url) => url.pathname === '/api/v1/reviews/questions', (route: Route) => {
    const q = new URL(route.request().url()).searchParams
    const term = q.get('search')?.toLowerCase()
    const rows = store.filter(
      (row) =>
        (!q.get('status') || row.status === q.get('status')) &&
        (!q.get('product') || row.product.id === q.get('product')) &&
        (!term || `${row.product.name} ${row.name} ${row.email} ${row.question} ${row.answer ?? ''}`.toLowerCase().includes(term)),
    )
    return route.fulfill({ json: page1(rows, { pending_count: store.filter((row) => row.status === 'pending').length }) })
  })
  await page.route(/\/api\/v1\/reviews\/questions\/[^/]+(\/(answer|reject))?$/, (route: Route) => {
    const request = route.request()
    const [, id, action] = new URL(request.url()).pathname.match(/\/questions\/([^/]+)(?:\/(\w+))?$/) ?? []
    const index = store.findIndex((row) => row.id === id)
    if (index < 0) return route.fulfill({ status: 404, json: { success: false, error: { code: 'NOT_FOUND', message: 'Not found.', details: {} }, meta: { request_id: 'e2e' } } })
    if (request.method() === 'DELETE') {
      store.splice(index, 1)
      return route.fulfill({ status: 204 })
    }
    if (action === 'answer') {
      const body = request.postDataJSON() as { answer: string; publish: boolean }
      store[index] = body.publish
        ? { ...store[index]!, answer: body.answer, status: 'published', answered_at: '2026-11-13T06:00:00Z', answered_by_name: 'Nadia Admin' }
        : { ...store[index]!, answer: body.answer }
    } else {
      store[index] = { ...store[index]!, status: 'rejected' }
    }
    return route.fulfill({ json: envelope(store[index]) })
  })
}

const questionItem = (page: Page, name: string) => page.getByRole('listitem', { name: new RegExp(`from ${name}$`) })

test('answers and publishes questions, saves a draft answer, rejects and deletes after confirming', async ({ page }) => {
  const store = seedQuestions()
  await mockQuestions(page, MANAGER, store)

  // The bell's link.
  await page.goto('/admin/reviews/questions?status=pending')
  await expect(page.getByRole('heading', { name: 'Questions' })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Reviews and questions' }).getByRole('link', { name: 'Questions' })).toHaveAttribute('aria-current', 'page')
  await expect(page.getByRole('tab', { name: 'To answer (3 waiting)' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('list', { name: 'Questions' }).getByRole('listitem')).toHaveCount(3)
  await expect(questionItem(page, 'Karim Ali').getByText('আকার কত বড়?')).toBeVisible()
  await expectNoHorizontalOverflow(page)

  // Answer and publish.
  const rina = questionItem(page, 'Rina Akter')
  await rina.getByRole('button', { name: 'Answer' }).click()
  const form = page.getByRole('form', { name: 'Answer to Rina Akter' })
  await form.getByLabel('Your answer').fill('Yes — 100% Rajshahi mangoes, no added colour.')
  const answer = page.waitForRequest((r: Request) => r.url().endsWith('/api/v1/reviews/questions/q-1/answer') && r.method() === 'POST')
  await form.getByRole('button', { name: 'Publish answer' }).click()
  expect((await answer).postDataJSON()).toEqual({ answer: 'Yes — 100% Rajshahi mangoes, no added colour.', publish: true })
  await expect(page.getByText('Answer published. It is now shown on the product page.')).toBeVisible()
  await expect(rina).toHaveCount(0)
  await expect(page.getByRole('tab', { name: 'To answer (2 waiting)' })).toBeVisible()

  // Save an answer without publishing: the question keeps waiting.
  const karim = questionItem(page, 'Karim Ali')
  await karim.getByRole('button', { name: 'Answer' }).click()
  await page.getByRole('form', { name: 'Answer to Karim Ali' }).getByLabel('Your answer').fill('৮০ সেমি লম্বা।')
  await page.getByRole('form', { name: 'Answer to Karim Ali' }).getByRole('button', { name: 'Save without publishing' }).click()
  await expect(page.getByText('Answer saved. It is not shown in the store until you publish it.')).toBeVisible()
  await expect(karim.getByText('Answer not published')).toBeVisible()
  await expect(karim.getByRole('button', { name: 'Publish answer' })).toBeVisible()

  // Reject spam, then delete it after confirming.
  const sumi = questionItem(page, 'Sumi Akter')
  await sumi.getByRole('button', { name: 'Reject' }).click()
  await expect(page.getByText('Question rejected. It is not shown in the store.')).toBeVisible()
  await expect(sumi).toHaveCount(0)
  await page.getByRole('tab', { name: 'Rejected' }).click()
  await expect(page).toHaveURL(/\/admin\/reviews\/questions\?status=rejected$/)
  await questionItem(page, 'Sumi Akter').getByRole('button', { name: 'Delete' }).click()
  const confirm = page.getByRole('alertdialog', { name: 'Delete this question?' })
  await expect(confirm).toContainText('Sumi Akter’s question about Baby Romper is removed for good, together with its answer.')
  await confirm.getByRole('button', { name: 'Cancel' }).click()
  expect(store).toHaveLength(3)
  await questionItem(page, 'Sumi Akter').getByRole('button', { name: 'Delete' }).click()
  await page.getByRole('alertdialog', { name: 'Delete this question?' }).getByRole('button', { name: 'Delete question' }).click()
  await expect(page.getByText('Question deleted.')).toBeVisible()
  await expect(page.getByText('No rejected questions')).toBeVisible()
  expect(store.map((q) => q.id)).toEqual(['q-1', 'q-2'])

  // Published: the answer shows with who answered.
  await page.getByRole('tab', { name: 'Published' }).click()
  const published = questionItem(page, 'Rina Akter')
  await expect(published.getByTestId('question-answer')).toContainText('Yes — 100% Rajshahi mangoes, no added colour.')
  await expect(published.getByTestId('question-answer')).toContainText('Answered by Nadia Admin')
  await expect(published.getByRole('button', { name: 'Unpublish' })).toBeVisible()
})

test('filters questions by search and product and keeps the filters in the address', async ({ page }) => {
  await mockQuestions(page, MANAGER, seedQuestions())
  await page.route('**/api/v1/products?*', (route) =>
    route.fulfill({ json: page1([{ id: 'p-1', name: 'Pran Mango Juice 1L', variants: [{ sku: 'PMJ-1' }], images: [], is_active: true }]) }),
  )

  await page.goto('/admin/reviews/questions?status=all')
  const list = page.getByRole('list', { name: 'Questions' })
  await expect(list.getByRole('listitem')).toHaveCount(3)
  await page.getByLabel('Search questions').fill('mangoes')
  await expect(page).toHaveURL(/search=mangoes/)
  await expect(list.getByRole('listitem')).toHaveCount(1)
  await page.getByLabel('Search questions').fill('')
  await expect(list.getByRole('listitem')).toHaveCount(3)

  await questionItem(page, 'Karim Ali').getByRole('button', { name: 'Show only questions about Baby Romper' }).click()
  await expect(page).toHaveURL(/product=p-2/)
  await expect(page.getByTestId('product-filter')).toContainText('Product: Baby Romper')
  await expect(list.getByRole('listitem')).toHaveCount(2)
  await page.getByRole('button', { name: 'Show questions about all products' }).click()
  await expect(list.getByRole('listitem')).toHaveCount(3)

  await page.getByRole('button', { name: 'Filter by product: All products' }).click()
  await page.getByRole('option', { name: /Pran Mango Juice 1L/ }).click()
  await expect(page).toHaveURL(/status=all&product=p-1/)
  await expect(list.getByRole('listitem')).toHaveCount(1)
  await expectNoHorizontalOverflow(page)
})

test('shows questions read-only to staff who may only view reviews', async ({ page }) => {
  await mockQuestions(page, ['branches.view', 'reviews.view'], seedQuestions())

  await page.goto('/admin/reviews/questions')
  await expect(questionItem(page, 'Rina Akter')).toBeVisible()
  await expect(page.getByTestId('questions-read-only')).toBeVisible()
  await expect(page.getByRole('group', { name: 'Question actions' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Filter by product/ })).toHaveCount(0)
})

/* ------------------------------------------------------------------------------------------------
 * Theme: product page layout
 * ---------------------------------------------------------------------------------------------- */

const listingColumns = { desktop: 4, tablet: 3, mobile: 1 }
const themeSettings = {
  colors,
  typography: { heading_font: 'baloo', body_font: 'poppins' },
  shape: { button_style: 'pill', card_radius: 12 },
  layout: {
    container_width: 1170, sticky_header: true, header_style: 'standard', footer_style: 'columns', card_style: 'standard', hero_style: 'full', heading_case: 'normal', top_bar: 'none',
    listing_columns: listingColumns,
    product: { gallery: 'left', thumbnails: 'bottom', sticky_summary: false, details: 'tabs' },
  },
  preset: 'default',
  logo_media_id: null,
  favicon_media_id: null,
  announcement: { enabled: false, text: null, link: null, background: '#6f55c2', foreground: '#ffffff', starts_at: null, ends_at: null },
  footer: { about: null, copyright: null, contact: { email: null, phone: null, address: null }, social: { facebook: null, instagram: null, youtube: null, tiktok: null, x: null, linkedin: null }, payment_logo_media_ids: [] },
}
const themeDraft = (overrides: Record<string, unknown> = {}) => ({
  settings: themeSettings, draft_revision: 4, has_unpublished_changes: false, draft_updated_at: null,
  published: { version_id: 'v-1', number: 1, published_at: '2026-11-01T10:00:00Z' }, preview_url: null, custom_css: null, has_custom_css: false, ...overrides,
})

test('designs the product page in the theme: saved with the draft, listing columns kept, then published', async ({ page }) => {
  await mockShell(page, MANAGER)
  await page.route('**/api/v1/storefront/theme/presets', (route) => route.fulfill({ json: envelope([]) }))
  await page.route('**/api/v1/storefront/theme/draft', (route) =>
    route.request().method() === 'PUT'
      ? route.fulfill({ json: envelope(themeDraft({ settings: (route.request().postDataJSON() as { settings: unknown }).settings, draft_revision: 5, has_unpublished_changes: true })) })
      : route.fulfill({ json: envelope(themeDraft()) }),
  )
  await page.route('**/api/v1/storefront/theme/publish', (route) =>
    route.fulfill({ json: envelope(themeDraft({ draft_revision: 5, published: { version_id: 'v-2', number: 2, published_at: '2026-11-14T10:00:00Z' } })) }),
  )

  await page.goto('/admin/storefront/theme')
  const card = page.getByRole('region', { name: 'Product page' })
  await expect(card.getByRole('radio', { name: 'Photos on the left' })).toBeChecked()
  // Owners click the option cards (the radios inside are visually hidden).
  const choose = async (name: string) => {
    await card.locator('label').filter({ has: page.getByRole('radio', { name, exact: true }) }).click()
    await expect(card.getByRole('radio', { name, exact: true })).toBeChecked()
  }
  await choose('Photos on the right')
  await choose('Beside the main photo')
  await card.getByRole('switch', { name: 'Keep the price and Add to cart in view' }).click()
  await choose('Fold-out sections')
  await expect(card.getByRole('img', { name: /^Product page: photos on the right, small photos beside the main photo, price and Add to cart stay in view/ })).toBeVisible()
  await expect(page.getByTestId('theme-status')).toContainText('Unsaved changes')
  await expectNoHorizontalOverflow(page)

  const put = page.waitForRequest((r: Request) => r.url().endsWith('/api/v1/storefront/theme/draft') && r.method() === 'PUT')
  await page.getByRole('button', { name: 'Save draft' }).click()
  const body = (await put).postDataJSON() as { revision: number; settings: { layout: Record<string, unknown> } }
  expect(body.revision).toBe(4)
  expect(body.settings.layout).toMatchObject({ listing_columns: listingColumns, product: { gallery: 'right', thumbnails: 'side', sticky_summary: true, details: 'accordion' } })
  await expect(page.getByText('Draft saved. Publish to show it on your store.')).toBeVisible()

  await page.getByRole('button', { name: 'Publish', exact: true }).click()
  const publish = page.waitForRequest((r: Request) => r.url().endsWith('/api/v1/storefront/theme/publish') && r.method() === 'POST')
  await page.getByRole('dialog', { name: 'Publish the theme?' }).getByRole('button', { name: 'Publish' }).click()
  await publish
  await expect(page.getByText('Theme published. Your store shows it now.')).toBeVisible()
})
