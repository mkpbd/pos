import { expect, test, type Page } from '@playwright/test'

/**
 * P2b admin against a mocked API: Marketing → Social posts (practice-mode connection through the
 * browser, composing a post from a product with a suggested caption, following it until it is
 * posted, retry / cancel, the Meta app settings), Marketing → Product feeds (copy, switch on, new
 * address) and the share / WhatsApp settings of the online store. Desktop and mobile.
 */

const envelope = (data: unknown, meta: Record<string, unknown> = {}) => ({ success: true, data, meta: { request_id: 'e2e', ...meta } })
const paged = (items: unknown[]) => envelope(items, { pagination: { current_page: 1, per_page: 25, total: items.length, last_page: 1 } })
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')

const me = {
  user: { id: 'u-1', name: 'Nadia Manager', email: 'nadia@berry.test', phone: null, is_platform_admin: false, last_login_at: null },
  organization: { id: 'o-1', name: 'Berry Kids', slug: 'berry-kids', base_currency: 'BDT', timezone: 'Asia/Dhaka', tax_mode: 'exclusive', status: 'active' },
  roles: [{ id: 'r-2', name: 'Online Store Manager', system_key: null }],
  permissions: ['branches.view', 'social.view', 'social.manage', 'products.view', 'media.manage', 'marketing.view', 'storefront.view', 'storefront.manage'],
  branches: [{ id: 'b-1', code: 'MAIN', name: 'Main Branch', is_active: true }],
}

const settings = (overrides: Record<string, unknown> = {}) => ({
  mode: 'sandbox', meta_app_id: null, secret_set: false, graph_version: 'v21.0', redirect_uri: 'https://berry.example.com/api/v1/social/meta/callback',
  live_ready: false, updated_at: null, ...overrides,
})
const demoPages = [
  { id: 'pg-1', name: 'Demo Page', instagram: { id: 'ig-1', username: 'demo_shop' } },
  { id: 'pg-2', name: 'Demo Page 2', instagram: null },
]
const accounts = (connected: boolean) => ({
  mode: 'sandbox', connected, sandbox: true,
  page: connected ? { id: 'pg-1', name: 'Demo Page', picture_url: null } : null,
  instagram: connected ? { id: 'ig-1', username: 'demo_shop', picture_url: null } : null,
  pages: connected ? demoPages : [], connected_at: connected ? '2026-11-14T09:00:00+06:00' : null, connected_by: connected ? { id: 'u-1', name: 'Nadia Manager' } : null,
})

const product = {
  id: 'p-1', name: 'Mango juice', description: null, type: 'standard', category: null, brand: null, unit: null, tax_rate: null, track_stock: true,
  track_batches: false, track_serials: false, max_discount_percent: null, options: null, is_active: true, archived_at: null,
  variants: [{ id: 'v-1', sku: 'MJ-1', name: null, option_values: {}, selling_price: '120.00', wholesale_price: null, reorder_level: '0', barcodes: [], is_active: true }],
  images: [
    { id: 'img-1', url: '/storage/products/mango-1.png', original_name: 'mango-front.jpg' },
    { id: 'img-2', url: '/storage/products/mango-2.png', original_name: 'mango-glass.jpg' },
  ],
}

const result = (target: string, overrides: Record<string, unknown> = {}) => ({
  target, status: 'pending', remote_id: null, permalink: null, error: null, short_link: null, published_at: null, sandbox: false, ...overrides,
})
const post = (overrides: Record<string, unknown> = {}) => ({
  id: 'sp-1', caption: 'Winter shawls are here', targets: ['facebook', 'instagram'], image_ids: ['img-1'], media_ids: [],
  media: [{ id: 'img-1', kind: 'product_image', url: '/storage/products/mango-1.png' }], link_url: null, product: { id: 'p-1', name: 'Mango juice' }, campaign: null,
  status: 'partially_published', scheduled_at: null, published_at: '2026-11-13T12:00:00+06:00',
  results: [
    result('facebook', { status: 'published', remote_id: 'fb_1', permalink: 'https://sandbox.invalid/facebook/fb_1', sandbox: true, short_link: { code: 'fbshawl', url: 'https://berry.example.com/go/fbshawl' } }),
    result('instagram', { status: 'failed', error: { code: 'TOKEN_EXPIRED', message: 'Reconnect Facebook' } }),
  ],
  allowed_actions: ['retry'], created_by: { id: 'u-1', name: 'Nadia Manager' }, created_at: '2026-11-13T11:58:00+06:00', updated_at: '2026-11-13T12:00:00+06:00',
  ...overrides,
})
const scheduledPost = post({
  id: 'sp-2', caption: 'Eid offer next week', status: 'scheduled', scheduled_at: '2026-12-20T04:00:00Z', published_at: null,
  results: [result('facebook'), result('instagram')], allowed_actions: ['edit', 'publish', 'cancel', 'delete'],
})

const feed = (channel: string, overrides: Record<string, unknown> = {}) => ({
  channel, enabled: true, xml_url: `https://berry.example.com/feeds/${channel}/a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6.xml`,
  csv_url: `https://berry.example.com/feeds/${channel}/a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6.csv`, item_count: 128,
  last_generated_at: '2026-11-14T10:30:00+06:00', updated_at: null, ...overrides,
})

async function mockBackend(page: Page) {
  const posted: { path: string; body: unknown }[] = []
  const state = {
    connected: false,
    posts: [post(), scheduledPost] as Record<string, unknown>[],
    polls: 0,
    feeds: [feed('meta'), feed('tiktok', { enabled: false, item_count: null, last_generated_at: null }), feed('pinterest')],
    store: { is_enabled: true, site_name: 'Berry Kids', meta_description: null, fulfilment_store_id: null, updated_at: null } as Record<string, unknown>,
  }
  const json = (route: Parameters<Parameters<Page['route']>[1]>[0]) => route.request().postDataJSON() as Record<string, unknown>

  await page.route('**/api/v1/**', (route) => route.fulfill({ json: paged([]) }))
  await page.route('**/storage/**', (route) => route.fulfill({ body: PNG, contentType: 'image/png' }))
  await page.route('**/sanctum/csrf-cookie', (route) => route.fulfill({ status: 204, headers: { 'Set-Cookie': 'XSRF-TOKEN=e2e; Path=/' } }))
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({ json: envelope(me) }))
  await page.route('**/api/v1/notifications/unread-count', (route) => route.fulfill({ json: envelope({ count: 0 }) }))
  await page.route((url) => url.pathname === '/api/v1/social/settings', (route) => {
    if (route.request().method() === 'PATCH') {
      posted.push({ path: 'settings', body: json(route) })
      return route.fulfill({ json: envelope(settings({ ...json(route), meta_app_secret: undefined, secret_set: true, live_ready: true })) })
    }
    return route.fulfill({ json: envelope(settings()) })
  })
  // Practice mode: the server stores the demo Page and sends the browser straight back.
  await page.route((url) => url.pathname === '/api/v1/social/meta/connect', (route) => {
    state.connected = true
    return route.fulfill({ status: 302, headers: { Location: '/admin/marketing/social?connected=1' } })
  })
  await page.route((url) => url.pathname === '/api/v1/social/accounts', (route) => route.fulfill({ json: envelope(accounts(state.connected)) }))
  await page.route((url) => url.pathname === '/api/v1/social/posts', (route) => {
    if (route.request().method() === 'POST') {
      posted.push({ path: 'posts', body: json(route) })
      const created = post({ ...json(route), id: 'sp-9', status: 'draft', published_at: null, results: [result('facebook'), result('instagram')], allowed_actions: ['edit', 'publish', 'delete'], media: product.images.map((i) => ({ id: i.id, kind: 'product_image', url: i.url })) })
      state.posts = [created, ...state.posts]
      return route.fulfill({ status: 201, json: envelope(created) })
    }
    return route.fulfill({ json: paged(state.posts) })
  })
  await page.route((url) => /^\/api\/v1\/social\/posts\/sp-\d+(\/\w+)?$/.test(url.pathname), (route) => {
    const [, , , , , id, action] = new URL(route.request().url()).pathname.split('/')
    const current = state.posts.find((p) => p.id === id) ?? post()
    const replace = (next: Record<string, unknown>) => {
      state.posts = state.posts.map((p) => (p.id === id ? next : p))
      return route.fulfill({ json: envelope(next) })
    }
    if (action === 'publish') {
      posted.push({ path: `posts/${id}/publish`, body: null })
      return replace({ ...current, status: 'publishing', results: [result('facebook', { status: 'publishing' }), result('instagram', { status: 'publishing' })], allowed_actions: [] })
    }
    if (action === 'retry') return replace({ ...current, status: 'published', results: (current.results as Record<string, unknown>[]).map((r) => ({ ...r, status: 'published', error: null, sandbox: true, permalink: `https://sandbox.invalid/${String(r.target)}/1` })), allowed_actions: [] })
    if (action === 'cancel') return replace({ ...current, status: 'draft', scheduled_at: null, allowed_actions: ['edit', 'publish', 'delete'] })
    // GET while posting: the second look finds it posted.
    state.polls += 1
    if (current.status === 'publishing' && state.polls >= 2) {
      return replace({
        ...current, status: 'published', published_at: '2026-11-14T12:00:00+06:00', allowed_actions: [],
        results: [
          result('facebook', { status: 'published', sandbox: true, permalink: 'https://sandbox.invalid/facebook/fb_9', short_link: { code: 'fbmango', url: 'https://berry.example.com/go/fbmango' } }),
          result('instagram', { status: 'published', sandbox: true, permalink: 'https://sandbox.invalid/instagram/p/demo9', short_link: { code: 'igmango', url: 'https://berry.example.com/go/igmango' } }),
        ],
      })
    }
    return route.fulfill({ json: envelope(current) })
  })
  await page.route((url) => url.pathname === '/api/v1/social/caption-suggestions', (route) => {
    posted.push({ path: 'caption-suggestions', body: json(route) })
    return route.fulfill({ json: envelope({ captions: ['ঈদ অফার! আমের জুস মাত্র ৳১২০ #ঈদ', 'Taste the summer: mango juice, ৳120.', 'Mango juice ৳120 #mango'], source: 'template', reason: 'disabled' }) })
  })
  await page.route((url) => url.pathname === '/api/v1/products', (route) => route.fulfill({ json: paged([product]) }))
  await page.route((url) => url.pathname === '/api/v1/products/p-1', (route) => route.fulfill({ json: envelope(product) }))
  await page.route((url) => url.pathname === '/api/v1/marketing/landing-pages', (route) => route.fulfill({ json: envelope([]) }))
  await page.route((url) => url.pathname === '/api/v1/social/feeds', (route) => route.fulfill({ json: envelope(state.feeds) }))
  await page.route((url) => /^\/api\/v1\/social\/feeds\/\w+(\/rotate)?$/.test(url.pathname), (route) => {
    const parts = new URL(route.request().url()).pathname.split('/')
    const channel = parts[5]
    const rotate = parts[6] === 'rotate'
    posted.push({ path: `feeds/${channel}${rotate ? '/rotate' : ''}`, body: rotate ? null : json(route) })
    const current = state.feeds.find((f) => f.channel === channel) ?? feed(channel ?? 'meta')
    const next = rotate
      ? { ...current, xml_url: `https://berry.example.com/feeds/${channel}/ffffeeeeddddccccbbbbaaaa99998888.xml` }
      : { ...current, ...json(route), item_count: 42, last_generated_at: '2026-11-14T12:30:00+06:00' }
    state.feeds = state.feeds.map((f) => (f.channel === channel ? next : f))
    return route.fulfill({ json: envelope(next) })
  })
  await page.route((url) => url.pathname === '/api/v1/storefront/settings', (route) => {
    if (route.request().method() === 'PATCH') {
      const body = json(route)
      posted.push({ path: 'storefront/settings', body })
      state.store = { ...state.store, ...body, ...(typeof body.whatsapp_number === 'string' ? { whatsapp_number: '8801712345678' } : {}) }
    }
    return route.fulfill({ json: envelope(state.store) })
  })
  await page.route((url) => url.pathname === '/api/v1/storefront/domains', (route) => route.fulfill({ json: envelope([]) }))
  await page.route((url) => url.pathname === '/api/v1/storefront/builder/documents', (route) => route.fulfill({ json: envelope([]) }))
  return { posted, state }
}

async function expectNoPageOverflow(page: Page) {
  const overflow = await page.evaluate<number>('document.documentElement.scrollWidth - document.documentElement.clientWidth')
  expect(overflow).toBeLessThanOrEqual(1)
}

test('practice mode: connect the demo Page, then post a product with a suggested caption', async ({ page }) => {
  const { posted } = await mockBackend(page)
  await page.goto('/admin/marketing/social')

  await expect(page.getByTestId('social-mode')).toContainText('Practice mode (sandbox)')
  await expect(page.getByRole('button', { name: 'New post' })).toHaveCount(0)
  await page.getByRole('link', { name: 'Connect the demo Page' }).click()

  await expect(page.getByText('Facebook is connected. You can post now.')).toBeVisible()
  await expect(page).toHaveURL(/\/admin\/marketing\/social$/)
  await expect(page.getByTestId('social-page-name')).toHaveText('Demo Page')
  await expect(page.getByTestId('social-instagram')).toContainText('@demo_shop')
  await expectNoPageOverflow(page)

  await page.getByRole('button', { name: 'New post' }).click()
  const dialog = page.getByRole('dialog', { name: 'New post' })
  await dialog.getByRole('button', { name: 'Choose a product' }).click()
  await page.getByRole('option', { name: /Mango juice/ }).click()
  await expect(dialog.getByRole('button', { name: 'mango-front.jpg, photo 1 of the post' })).toHaveAttribute('aria-pressed', 'true')
  await dialog.getByRole('button', { name: 'mango-glass.jpg' }).click()
  await expect(dialog.getByTestId('photo-count')).toHaveText('2 of 10 chosen')

  await dialog.getByRole('button', { name: 'Suggest captions' }).click()
  await dialog.getByRole('combobox', { name: 'Language' }).click()
  await page.getByRole('option', { name: 'বাংলা (Bangla)' }).click()
  await dialog.getByRole('button', { name: 'Suggest', exact: true }).click()
  await expect(dialog.getByTestId('caption-source')).toContainText('AI is off for your shop')
  await dialog.getByRole('button', { name: 'Use this caption 1' }).click()
  await expect(dialog.getByRole('textbox', { name: 'Caption' })).toHaveValue('ঈদ অফার! আমের জুস মাত্র ৳১২০ #ঈদ')
  await expect(dialog.getByRole('textbox', { name: 'Caption' })).toBeFocused()
  await expect(dialog.getByTestId('caption-counter')).toContainText('32 / 2,200 characters · 1 hashtag')
  await expect(dialog.getByTestId('instagram-rules')).toContainText('Up to 30 hashtags (now 1)')

  await dialog.getByRole('button', { name: 'Post now' }).click()
  await expect(page.getByText('Posted to Facebook and Instagram (practice mode: nothing was really posted).')).toBeVisible({ timeout: 15_000 })
  const created = page.getByTestId('social-post-sp-9')
  // Practice permalinks never open: text with a note, not a link.
  await expect(created.getByTestId('practice-instagram')).toContainText('Practice post — not on Instagram (https://sandbox.invalid/instagram/p/demo9)')
  await expect(created.getByRole('link')).toHaveCount(0)
  await expect(created).toContainText('/go/fbmango')
  expect(posted.find((p) => p.path === 'caption-suggestions')?.body).toEqual({ product_id: 'p-1', language: 'bn', tone: 'friendly' })
  expect(posted.find((p) => p.path === 'posts')?.body).toEqual({
    caption: 'ঈদ অফার! আমের জুস মাত্র ৳১২০ #ঈদ', targets: ['facebook', 'instagram'], image_ids: ['img-1', 'img-2'], media_ids: [], link_url: null, product_id: 'p-1', campaign_id: null, scheduled_at: null,
  })
  expect(posted.some((p) => p.path === 'posts/sp-9/publish')).toBe(true)
})

test('post list: plain errors, retry, cancel a schedule; a failed connection explained', async ({ page }) => {
  const { state } = await mockBackend(page)
  state.connected = true
  await page.goto('/admin/marketing/social?error=access_denied')

  await expect(page.getByRole('alert')).toContainText('The Facebook login was cancelled, so nothing was connected.')
  await expect(page).toHaveURL(/\/admin\/marketing\/social$/)

  const failed = page.getByTestId('social-post-sp-1')
  await expect(failed).toContainText('Partly posted')
  await expect(failed.getByTestId('result-instagram')).toContainText('Facebook wants you to log in again. Reconnect Facebook, then retry.')
  await failed.getByRole('button', { name: 'Retry Instagram' }).click()
  await expect(page.getByText('Posted to Facebook and Instagram (practice mode: nothing was really posted).')).toBeVisible()

  const scheduled = page.getByTestId('social-post-sp-2')
  await expect(scheduled).toContainText('Waiting for its time')
  await scheduled.getByRole('button', { name: 'Cancel schedule' }).click()
  await expect(page.getByText('The schedule is cancelled. The post is a draft again.')).toBeVisible()
  await expect(scheduled).toContainText('Draft')
  await expectNoPageOverflow(page)
})

test('Meta app: live mode needs the keys and warns that the demo Page is disconnected', async ({ page }) => {
  const { posted, state } = await mockBackend(page)
  state.connected = true
  await page.goto('/admin/marketing/social')

  const form = page.getByRole('form', { name: 'Meta app settings' })
  await form.getByRole('radio', { name: 'Live' }).check()
  await form.getByRole('button', { name: 'Save Meta app settings' }).click()
  await expect(form.getByText('Live mode needs the app ID.')).toBeVisible()
  await expect(form.getByText('Live mode needs the app secret.')).toBeVisible()

  await form.getByLabel('App ID').fill('1234567890123456')
  await form.getByLabel('App secret').fill('s3cret-value')
  await form.getByRole('button', { name: 'Save Meta app settings' }).click()
  const confirm = page.getByRole('alertdialog', { name: 'Switch to live mode?' })
  await expect(confirm).toContainText('Changing the mode disconnects Demo Page.')
  await confirm.getByRole('button', { name: 'Switch to live' }).click()
  await expect(page.getByText('Live mode is on. Connect your Facebook Page to post for real.')).toBeVisible()
  expect(posted.find((p) => p.path === 'settings')?.body).toEqual({ mode: 'live', meta_app_id: '1234567890123456', meta_app_secret: 's3cret-value' })
  await expect(form.getByLabel('App secret')).toHaveValue('')
})

test('product feeds: copy the address, switch a feed on, make a new address', async ({ page, context, browserName }) => {
  if (browserName === 'chromium') await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  const { posted } = await mockBackend(page)
  await page.goto('/admin/marketing/feeds')

  const meta = page.getByTestId('feed-meta')
  await expect(meta.getByRole('heading', { name: 'Where to paste this: Meta Commerce Manager' })).toBeVisible()
  await meta.getByRole('button', { name: 'Copy the Meta feed address' }).click()
  await expect(page.getByText('Feed address copied.')).toBeVisible()
  expect(await page.evaluate<string>('navigator.clipboard.readText()')).toContain('/feeds/meta/')
  await expectNoPageOverflow(page)

  const tiktok = page.getByTestId('feed-tiktok')
  await expect(tiktok).toContainText('Not made yet')
  await tiktok.getByRole('switch', { name: 'Send my products to TikTok' }).click()
  await expect(page.getByText('The TikTok feed is on with 42 products.')).toBeVisible()
  await expect(tiktok.getByTestId('feed-tiktok-count')).toHaveText('42')

  await page.getByTestId('feed-pinterest').getByRole('button', { name: 'Make a new address' }).click()
  const confirm = page.getByRole('alertdialog', { name: 'Make a new Pinterest feed address?' })
  await confirm.getByRole('button', { name: 'Make new address' }).click()
  await expect(page.getByTestId('feed-pinterest').getByLabel('Feed address', { exact: true })).toHaveValue(/ffffeeeedddd/)
  expect(posted.map((p) => p.path)).toEqual(['feeds/tiktok', 'feeds/pinterest/rotate'])
})

test('online store settings: share buttons and the WhatsApp number', async ({ page }) => {
  const { posted } = await mockBackend(page)
  await page.goto('/admin/storefront')

  const share = page.getByRole('switch', { name: 'Show share buttons' })
  await expect(share).toBeChecked()
  await share.click()
  await expect(page.getByText('Share buttons are hidden.')).toBeVisible()

  await page.getByLabel('WhatsApp number').fill('12345')
  await page.getByRole('button', { name: 'Save number' }).click()
  await expect(page.getByText('Enter a mobile number like 01712345678 or +8801712345678.')).toBeVisible()
  await page.getByLabel('WhatsApp number').fill('01712345678')
  await page.getByRole('button', { name: 'Save number' }).click()
  await expect(page.getByText('WhatsApp number saved: +8801712345678.')).toBeVisible()
  await expect(page.getByLabel('WhatsApp number')).toHaveValue('+8801712345678')
  await expect(page.getByRole('link', { name: /Try the chat link/ })).toHaveAttribute('href', 'https://wa.me/8801712345678')
  expect(posted.filter((p) => p.path === 'storefront/settings').map((p) => p.body)).toEqual([{ share_buttons: false }, { whatsapp_number: '01712345678' }])
  await expectNoPageOverflow(page)
})
