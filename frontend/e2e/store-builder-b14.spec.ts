import { expect, test, type FrameLocator, type Page } from '@playwright/test'

/*
 * B14 editor on a mocked backend: the Page builder's "Store pages" group (design from the ready
 * design, "Use the standard page" with a confirmation), and a store page design in the editor —
 * the toolbar's "Preview with" sample (a category) reaching the canvas and the live text preview,
 * the Add panel offering the main part once, and the page check adding a missing main part.
 */

const envelope = (data: unknown, meta: Record<string, unknown> = {}) => ({ success: true, data, meta: { request_id: 'e2e', ...meta } })
const page1 = (items: unknown[]) => envelope(items, { pagination: { current_page: 1, per_page: 24, total: items.length, last_page: 1 } })

const me = {
  user: { id: 'u-1', name: 'Nadia Store', email: 'nadia@berry.test', phone: null, is_platform_admin: false, last_login_at: null },
  organization: { id: 'o-1', name: 'Green Basket', slug: 'green-basket', base_currency: 'BDT', timezone: 'Asia/Dhaka', tax_mode: 'exclusive', status: 'active', ai_enabled: false },
  roles: [{ id: 'r-9', name: 'Online Store Manager', system_key: 'online_store_manager' }],
  permissions: ['branches.view', 'media.manage', 'storefront.manage', 'storefront.view', 'storefront.publish'],
  branches: [{ id: 'b-1', code: 'MAIN', name: 'Main Branch', is_active: true }],
  ai_enabled: false,
}

async function mockCommon(page: Page) {
  await page.route('**/api/v1/**', (route) => route.fulfill({ json: page1([]) }))
  await page.route('**/sanctum/csrf-cookie', (route) => route.fulfill({ status: 204, headers: { 'Set-Cookie': 'XSRF-TOKEN=e2e; Path=/' } }))
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({ json: envelope(me) }))
  await page.route('**/api/v1/notifications/unread-count', (route) => route.fulfill({ json: envelope({ count: 0 }) }))
}

const CAT_ID = '01a1c9d9-0000-7000-8000-0000000000c1'
const BLOG_ID = '01a1c9d9-0000-7000-8000-0000000000b1'

const summary = (id: string, template: string, title: string, published: boolean, revision = 2) => ({
  id,
  kind: 'page',
  key: `template:${template}`,
  template,
  title,
  schema_version: 1,
  draft_revision: revision,
  has_unpublished_changes: !published,
  draft_updated_at: '2026-11-18T08:00:00+00:00',
  published: published ? { version_id: 'v-1', number: 1, published_at: '2026-11-18T08:00:00+00:00' } : null,
  path: null,
  preview_url: null,
  context: null,
})

/* ----------------------------------------------------------------------------------------------
 * Pages list
 * -------------------------------------------------------------------------------------------- */

test.describe('B14 store pages list', () => {
  test('design a store page from the ready design; go back to the standard page', async ({ page, isMobile }) => {
    const calls: { create: unknown; unpublish: number } = { create: null, unpublish: 0 }
    let categoryLive = true
    await mockCommon(page)
    await page.route('**/api/v1/storefront/builder/documents', (route) => {
      if (route.request().method() === 'POST') {
        calls.create = route.request().postDataJSON()
        return route.fulfill({ status: 201, json: envelope({ ...summary('d-order', 'order', 'Order / thank you', false, 0), content: { schema_version: 1, sections: [] } }) })
      }
      return route.fulfill({ json: envelope([summary(CAT_ID, 'category', 'Category page', categoryLive)]) })
    })
    await page.route(`**/api/v1/storefront/builder/documents/${CAT_ID}/unpublish`, (route) => {
      calls.unpublish += 1
      categoryLive = false
      return route.fulfill({ json: envelope({ ...summary(CAT_ID, 'category', 'Category page', false), content: { schema_version: 1, sections: [] } }) })
    })
    // The editor the new design opens in.
    await page.route('**/api/v1/storefront/builder/documents/d-order', (route) => route.fulfill({ json: envelope({ ...summary('d-order', 'order', 'Order / thank you', false, 0), content: { schema_version: 1, sections: [] }, global: null }) }))
    await page.route('**/api/v1/storefront/builder/elements', (route) => route.fulfill({ json: envelope({ types: ELEMENTS, limits: {}, enums: {} }) }))
    await page.route('**/api/v1/storefront/builder/canvas-context*', (route) => route.fulfill({ json: envelope({ bootstrap, store_url: null, locales: ['en'] }) }))
    await page.route('**/api/v1/storefront/builder/sample-context*', (route) => route.fulfill({ json: envelope({ context: null, sample: null, choices: [{ id: 'sample', label: 'Sample order' }] }) }))
    await page.goto('/admin/storefront/pages')

    const group = page.getByRole('region', { name: 'Store pages' })
    await expect(group.getByTestId(/^store-page-row-/)).toHaveCount(7)
    const category = page.getByTestId('store-page-row-category')
    await expect(category.getByText(/Shoppers see your design/)).toBeVisible()

    await category.getByRole('button', { name: 'Use the standard page: Category pages' }).click()
    const confirm = page.getByRole('alertdialog', { name: 'Use the standard page for “Category pages”?' })
    await expect(confirm.getByText(/Your design stays as a draft/)).toBeVisible()
    await confirm.getByRole('button', { name: 'Use the standard page' }).click()
    await expect(category.getByText('Not published')).toBeVisible()
    expect(calls.unpublish).toBe(1)

    const order = page.getByTestId('store-page-row-order')
    await expect(order.getByText('Standard page', { exact: true })).toBeVisible()
    await expect(order.getByRole('button', { name: 'Start an empty design: Order / thank you' })).toBeVisible()
    await order.getByRole('button', { name: 'Design this page: Order / thank you' }).click()
    await expect(page).toHaveURL(/\/admin\/storefront\/builder\/d-order$/)
    expect(calls.create).toEqual({ kind: 'page', key: 'template:order', title: 'Order / thank you', from: 'starter' })
    // The editor is a desktop tool; there the order page previews with an order.
    if (!isMobile) await expect(page.getByTestId('sample-picker')).toBeVisible({ timeout: 30_000 })
  })
})

/* ----------------------------------------------------------------------------------------------
 * Editor
 * -------------------------------------------------------------------------------------------- */

const themeSettings = {
  colors: { primary: '#0f766e', primary_foreground: '#ffffff', accent: '#134e4a', accent_foreground: '#ffffff', highlight: '#15803d', sale: '#c2410c', heading: '#10302c', text: '#475569', canvas: '#f0fdfa', surface: '#ffffff', border: '#cce7e1' },
  typography: { heading_font: 'baloo', body_font: 'poppins' },
  shape: { button_style: 'pill', card_radius: 12 },
  layout: { container_width: 1170, sticky_header: true },
  logo_media_id: null,
  favicon_media_id: null,
  announcement: { enabled: false, text: null, link: null, background: '#6f55c2', foreground: '#ffffff', starts_at: null, ends_at: null },
  footer: { about: null, copyright: null, contact: { email: null, phone: '01700000000', address: null }, social: { facebook: null, instagram: null, youtube: null, tiktok: null, x: null, linkedin: null }, payment_logo_media_ids: [] },
}

const bootstrap = {
  store: { name: 'Green Basket', description: 'Organic groceries', prices_include_tax: true, currency: 'BDT', locales: ['en'], default_locale: 'en' },
  locale: 'en',
  preview: false,
  builder: { home: false },
  theme: { ...themeSettings, logo: null, favicon: null, announcement: null, footer: { about: null, copyright: null, contact: { email: null, phone: '01700000000', address: null }, social: {}, payment_logos: [] }, custom_css: null },
  menus: {},
}

const LISTING = {
  scope: 'current',
  category_ids: [],
  brand_ids: [],
  filters: { price: true, brand: true, category: true, attributes: true, availability: true, on_sale: true },
  filter_layout: 'sidebar',
  sort_default: 'featured',
  per_page: 24,
  columns: { desktop: 3, tablet: 3, mobile: 2 },
  show_count: true,
  pagination: 'pages',
}
const meta = (type: string, group: string, label: string, translatable: string[], props: Record<string, unknown>) => ({ type, group, label, translatable, props, children: null })
const ELEMENTS = [
  meta('heading', 'content', 'Heading', ['text'], { text: 'Heading', level: 2, link: null }),
  meta('dynamic_text', 'content', 'Text from this page', ['prefix', 'suffix', 'fallback'], { field: 'store.name', tag: 'p', prefix: '', suffix: '', fallback: '', format: 'default' }),
  meta('product_listing', 'commerce', 'Product listing', [], { ...LISTING, scope: 'all' }),
  meta('blog_post_body', 'content', 'Blog post', [], { show_cover: true, show_meta: true, show_share: true, show_related: true }),
  meta('order_summary', 'commerce', 'Order details', [], { show_timeline: true, show_items: true, show_address: true, show_delivery: true }),
  meta('not_found_message', 'content', 'Page not found message', ['heading', 'text'], { heading: '', text: '', show_search: true, show_links: true }),
]

const VIS = { desktop: true, tablet: true, mobile: true }
const node = (id: string, type: string, props: Record<string, unknown>) => ({ id, type, props, style: {}, visibility: VIS, hidden: false, schedule: null, translations: {} })
type AnyNode = { id: string; type: string; props?: Record<string, unknown>; columns?: { elements: AnyNode[] }[] }
type Content = { schema_version: 1; sections: AnyNode[] }

const sectionOf = (id: string, elements: AnyNode[]): AnyNode => ({ ...node(id, 'section', { layout: 'boxed', anchor: null }), columns: [{ id: `c_${id.slice(2)}`, type: 'column', width: { base: 100 }, style: {}, elements }] }) as unknown as AnyNode

function findType(content: Content, type: string): AnyNode[] {
  const out: AnyNode[] = []
  const walk = (nodes: AnyNode[]) => {
    for (const n of nodes) {
      if (n.type === type) out.push(n)
      for (const column of n.columns ?? []) walk(column.elements)
    }
  }
  walk(content.sections)
  return out
}

const CATEGORIES = [
  { id: 'c-1', name: 'Panjabi', url: '/category/panjabi' },
  { id: 'c-2', name: 'Saree', url: '/category/saree' },
]
const contextFor = (id: string | null) => {
  const category = id === 'c-2' ? { id: 'c-2', slug: 'saree', name: 'Saree', description: null, product_count: 12 } : { id: 'c-1', slug: 'panjabi', name: 'Panjabi', description: null, product_count: 42 }
  return { template: 'category', store: { name: 'Green Basket', phone: '01700000000', email: null, address: null }, category }
}

async function openEditor(page: Page, doc: { id: string; template: string; title: string; content: Content }) {
  const b = { revision: 1, content: doc.content, sampleIds: [] as (string | null)[] }
  const detail = () => ({ ...summary(doc.id, doc.template, doc.title, false, b.revision), content: b.content, global: null })
  await mockCommon(page)
  await page.route('**/api/v1/storefront/link-targets*', (route) => route.fulfill({ json: envelope({ pages: [], categories: CATEGORIES, brands: [], blog_categories: [], blog_posts: [] }) }))
  await page.route('**/api/v1/storefront/fonts', (route) => route.fulfill({ json: envelope({ fonts: [], limit: 4, max_bytes: 512000 }) }))
  await page.route('**/api/v1/storefront/theme', (route) => route.fulfill({ json: envelope({ settings: themeSettings, custom_css: null, has_custom_css: false, updated_at: null }) }))
  await page.route('**/api/v1/storefront/builder/elements', (route) => route.fulfill({ json: envelope({ types: ELEMENTS, limits: {}, enums: {} }) }))
  await page.route('**/api/v1/storefront/builder/canvas-context*', (route) => route.fulfill({ json: envelope({ bootstrap, store_url: 'https://greenbasket.com.bd', locales: ['en'] }) }))
  await page.route('**/api/v1/storefront/builder/sample-context*', (route) => {
    const url = new URL(route.request().url())
    const id = url.searchParams.get('id')
    b.sampleIds.push(id)
    return route.fulfill({ json: envelope({ context: contextFor(id), sample: null, choices: null }) })
  })
  await page.route(`**/api/v1/storefront/builder/documents/${doc.id}`, (route) => route.fulfill({ json: envelope(detail()) }))
  await page.route(`**/api/v1/storefront/builder/documents/${doc.id}/draft`, (route) => {
    const body = route.request().postDataJSON() as { content: Content }
    b.revision += 1
    b.content = body.content
    return route.fulfill({ json: envelope(detail()) })
  })
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.goto(`/admin/storefront/builder/${doc.id}`)
  await expect(page.getByTestId('store-builder-editor')).toBeVisible({ timeout: 30_000 })
  return b
}

const canvas = (page: Page): FrameLocator => page.frameLocator('[data-testid="builder-canvas"]')

test.describe('B14 store page designs in the editor', () => {
  test.beforeEach(({ isMobile }) => {
    test.skip(isMobile, 'The page builder is a desktop tool.')
  })

  test('preview with a category: the canvas and the live text follow the sample; the main part goes in once', async ({ page }) => {
    await page.addInitScript('window.localStorage.clear()')
    const b = await openEditor(page, {
      id: CAT_ID,
      template: 'category',
      title: 'Category page',
      content: { schema_version: 1, sections: [sectionOf('s_head01', [node('e_name01', 'dynamic_text', { field: 'category.name', tag: 'h1', prefix: '', suffix: '', fallback: '', format: 'default' }), node('e_list01', 'product_listing', LISTING)])] },
    })
    await expect(page.getByTestId('document-placement')).toContainText('every category page')

    const picker = page.getByTestId('sample-picker')
    await expect(picker.getByTestId('sample-label')).toHaveText('Panjabi')
    await expect(canvas(page).getByRole('heading', { level: 1, name: 'Panjabi' })).toBeVisible({ timeout: 15_000 })

    await picker.click()
    const options = page.getByRole('radiogroup', { name: 'Preview with a category' })
    await expect(options.getByRole('radio', { name: 'Panjabi' })).toBeChecked()
    await options.getByText('Saree').click()
    await expect(picker.getByTestId('sample-label')).toHaveText('Saree')
    expect(b.sampleIds).toContain('c-2')
    await expect(canvas(page).getByRole('heading', { level: 1, name: 'Saree' })).toBeVisible({ timeout: 15_000 })

    // The live text's inspector: the value with this sample, words before it saved into the draft.
    await page.getByRole('tab', { name: 'Layers' }).click()
    await page.getByTestId('layer-e_name01').locator('[data-layer-id]').click()
    const inspector = page.getByRole('complementary', { name: 'Inspector' })
    await expect(inspector.getByRole('heading', { name: 'Text from this page' })).toBeVisible()
    await expect(inspector.getByTestId('dynamic-preview')).toContainText('With the sample (Saree)')
    await inspector.getByLabel('Words before').fill('Shop ')
    await expect(inspector.getByTestId('dynamic-preview-value')).toHaveText('Shop Saree')
    await expect.poll(() => findType(b.content, 'dynamic_text')[0]?.props?.prefix, { timeout: 10_000 }).toBe('Shop ')

    // Add panel: the product list is on the page already; other pages' main parts aren't offered.
    await page.getByRole('tab', { name: 'Add' }).click()
    await expect(page.getByTestId('add-product_listing')).toHaveAttribute('aria-disabled', 'true')
    await expect(page.getByTestId('add-blog_post_body')).toHaveCount(0)
    await expect(page.getByTestId('add-order_summary')).toHaveCount(0)
    await expect(page.getByTestId('add-dynamic_text')).toBeVisible()
  })

  test('the page check asks for the main part and adds it', async ({ page }) => {
    const b = await openEditor(page, {
      id: BLOG_ID,
      template: 'blog_post',
      title: 'Blog post',
      content: { schema_version: 1, sections: [sectionOf('s_head01', [node('e_head01', 'heading', { text: 'From our blog', level: 2, link: null })])] },
    })
    await expect(page.getByTestId('check-badge')).toBeVisible()
    await page.getByTestId('check-page-button').click()
    const issue = page.getByText(/This store page needs its main part: the blog post/)
    await expect(issue).toBeVisible()
    await page.getByRole('button', { name: /Add it: This store page needs its main part/ }).click()
    await expect.poll(() => findType(b.content, 'blog_post_body').length, { timeout: 10_000 }).toBe(1)
    await expect(issue).toHaveCount(0)
    await expect(page.getByTestId('sample-picker')).toBeVisible()
  })
})
