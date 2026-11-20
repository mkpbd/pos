import { expect, test, type Page } from '@playwright/test'

/**
 * AI2a Online store → AI help against a mocked API: the tab (only with AI on), Drafts (write
 * drafts → progress polling → review drawer → edit + approve, stale "Approve anyway", bulk
 * approve), Categories (suggest, confidence in words, apply), Bundle ideas (describe with
 * Bangla, add to frequently bought together) and the products list "Write AI drafts" action.
 * No real AI provider is ever called.
 */

const envelope = (data: unknown, meta: Record<string, unknown> = {}) => ({ success: true, data, meta: { request_id: 'e2e', ...meta } })
const paged = (items: unknown[], meta: Record<string, unknown> = {}) => envelope(items, { pagination: { current_page: 1, per_page: 20, total: items.length, last_page: 1 }, ...meta })
const failure = (code: string, message: string, details: Record<string, unknown> = {}) => ({ success: false, error: { code, message, details }, meta: { request_id: 'e2e' } })

const meFor = (aiEnabled: boolean) => ({
  user: { id: 'u-1', name: 'Nadia Admin', email: 'nadia@berry.test', phone: null, is_platform_admin: false, last_login_at: null },
  organization: { id: 'o-1', name: 'Berry Kids', slug: 'berry-kids', base_currency: 'BDT', timezone: 'Asia/Dhaka', tax_mode: 'exclusive', status: 'active' },
  roles: [{ id: 'r-1', name: 'Organization Admin', system_key: 'organization_admin' }],
  permissions: ['branches.view', 'storefront.view', 'online_catalog.view', 'online_catalog.manage', 'products.view', 'products.manage'],
  branches: [{ id: 'b-1', code: 'MAIN', name: 'Main Branch', is_active: true }],
  ai_enabled: aiEnabled,
})

const batch = (over: Record<string, unknown> = {}) => ({
  id: 'run-1', subject: 'product', criteria: { missing: ['description'], ids: null }, fields: ['short_description'], languages: ['en'], tone: 'friendly', length: 'medium', notes: null,
  total: 2, done: 0, failed: 0, status: 'running', progress_percent: 0, drafts: { pending: 0, approved: 0, rejected: 0, failed: 0, stale: 0 }, created_by: 'u-1', created_at: '2026-11-20T10:00:00Z', updated_at: '2026-11-20T10:00:00Z',
  ...over,
})

const draft = (over: Record<string, unknown> = {}) => ({
  id: 'd-1', batch_id: 'run-1', subject: 'product', subject_id: 'p-1', subject_name: 'Baby Romper', language: 'en', status: 'pending', error: null, stale: false,
  fields: {
    short_description: { proposed: 'A soft cotton romper for everyday play.', current: null, changed: false },
    seo_title: { proposed: 'Baby Romper — soft cotton', current: 'Romper', changed: false },
  },
  missing_info: ['size range'], reviewed_by: null, reviewed_at: null, created_at: '2026-11-20T10:00:00Z',
  ...over,
})

const products = [
  { id: 'p-1', name: 'Baby Romper', type: 'standard', is_active: true, archived_at: null, category: null, images: [], options: null, variants: [{ id: 'v-1', sku: 'ROMP-1', selling_price: '750.00', name: null }] },
  { id: 'p-2', name: 'Cotton Socks', type: 'standard', is_active: true, archived_at: null, category: null, images: [], options: null, variants: [{ id: 'v-2', sku: 'SOCK-1', selling_price: '150.00', name: null }] },
]

type Calls = { batches: unknown[]; approvals: unknown[]; approveMany: unknown[]; applies: unknown[]; bundleApplies: unknown[] }

async function mockBackend(page: Page, { aiEnabled = true }: { aiEnabled?: boolean } = {}) {
  const calls: Calls = { batches: [], approvals: [], approveMany: [], applies: [], bundleApplies: [] }
  let polls = 0
  let approveCount = 0
  await page.addInitScript(() => localStorage.setItem('pos-session', JSON.stringify({ state: { activeBranchId: 'b-1' }, version: 0 })))
  await page.route('**/api/v1/**', (route) => route.fulfill({ json: paged([]) }))
  await page.route('**/sanctum/csrf-cookie', (route) => route.fulfill({ status: 204, headers: { 'Set-Cookie': 'XSRF-TOKEN=e2e; Path=/' } }))
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({ json: envelope(meFor(aiEnabled)) }))
  await page.route('**/api/v1/notifications/unread-count', (route) => route.fulfill({ json: envelope({ count: 0 }) }))
  await page.route((url) => url.pathname === '/api/v1/products', (route) => route.fulfill({ json: paged(products) }))
  await page.route((url) => url.pathname === '/api/v1/online-catalog/ai/batches', (route) => {
    if (route.request().method() === 'POST') {
      calls.batches.push(route.request().postDataJSON())
      return route.fulfill({ status: 201, json: envelope(batch({ status: 'queued' })) })
    }
    return route.fulfill({ json: paged([]) })
  })
  // Polled every 3 s: running with one done, then finished.
  await page.route('**/api/v1/online-catalog/ai/batches/run-1', (route) => {
    polls += 1
    return route.fulfill({ json: envelope(polls < 2 ? batch({ done: 1, progress_percent: 50 }) : batch({ status: 'done', done: 2, progress_percent: 100 })) })
  })
  await page.route((url) => url.pathname === '/api/v1/online-catalog/ai/drafts', (route) =>
    route.fulfill({ json: paged([draft(), draft({ id: 'd-2', subject: 'brand', subject_id: 'br-1', subject_name: 'Berry Basics', language: 'bn', stale: true, status: 'stale', fields: { seo_title: { proposed: 'বেরি বেসিকস', current: 'Berry', changed: true } } })]) }),
  )
  await page.route('**/api/v1/online-catalog/ai/drafts/*/approve', (route) => {
    approveCount += 1
    calls.approvals.push(route.request().postDataJSON())
    const body = route.request().postDataJSON() as { force?: boolean }
    if (route.request().url().includes('/d-2/') && !body.force) return route.fulfill({ status: 409, json: failure('DRAFT_STALE', 'Changed', { fields: ['seo_title'] }) })
    return route.fulfill({ json: envelope(draft({ status: 'approved', n: approveCount })) })
  })
  await page.route('**/api/v1/online-catalog/ai/drafts/approve-many', (route) => {
    calls.approveMany.push(route.request().postDataJSON())
    return route.fulfill({ json: envelope({ approved: 1, skipped: [] }) })
  })
  await page.route('**/api/v1/online-catalog/ai/category-suggestions', (route) =>
    route.fulfill({
      json: envelope({
        suggestions: [
          { product: { id: 'p-1', name: 'Baby Romper' }, category: { id: 'c-1', path: 'Baby › Clothing' }, confidence: 'high', reason: 'A romper is baby clothing.' },
          { product: { id: 'p-2', name: 'Cotton Socks' }, category: { id: 'c-2', path: 'Kids › Socks' }, confidence: 'low', reason: 'Could be for adults too.' },
        ],
        categories_considered: 8,
      }),
    }),
  )
  await page.route('**/api/v1/online-catalog/ai/category-suggestions/apply', (route) => {
    const body = route.request().postDataJSON() as { items: { product_id: string }[] }
    calls.applies.push(body)
    return route.fulfill({ json: envelope({ applied: body.items.map((i) => i.product_id), skipped: [] }) })
  })
  await page.route((url) => url.pathname === '/api/v1/online-catalog/bundle-ideas', (route) =>
    route.fulfill({
      json: paged([{ anchor: { id: 'p-1', name: 'Baby Romper', image_url: null }, frequently_bought_count: 0, products: [{ id: 'p-2', name: 'Cotton Socks', image_url: null, score: '0.5', orders_together: 12 }] }], { last_run: '2026-11-19', computed_at: '2026-11-19T20:00:00Z' }),
    }),
  )
  await page.route('**/api/v1/online-catalog/bundle-ideas/describe', (route) =>
    route.fulfill({ json: envelope({ title: 'Cosy baby set', pitch: 'A soft romper with warm socks.', translations: { bn: { title: 'আরামদায়ক বেবি সেট', pitch: 'নরম রম্পার আর গরম মোজা।' } } }) }),
  )
  await page.route('**/api/v1/online-catalog/bundle-ideas/apply', (route) => {
    calls.bundleApplies.push(route.request().postDataJSON())
    return route.fulfill({ json: envelope({ anchor_id: 'p-1', added: ['p-2'], frequently_bought: [{ id: 'p-2', name: 'Cotton Socks', image_url: null, sku: 'SOCK-1' }] }) })
  })
  return calls
}

async function expectNoPageOverflow(page: Page) {
  const overflow = await page.evaluate<number>('document.documentElement.scrollWidth - document.documentElement.clientWidth')
  expect(overflow).toBeLessThanOrEqual(1)
}

test('the AI help tab appears only while AI is on', async ({ page }) => {
  await mockBackend(page, { aiEnabled: false })
  await page.goto('/admin/storefront/ai')
  await expect(page.getByText('AI help is turned off')).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Online store sections' }).getByRole('link', { name: 'AI help' })).toHaveCount(0)
})

test('writes drafts, follows the run, reviews and approves them', async ({ page }) => {
  const calls = await mockBackend(page)
  await page.goto('/admin/online-store/ai')
  await expect(page).toHaveURL(/\/admin\/storefront\/ai$/)
  await expect(page.getByRole('navigation', { name: 'Online store sections' }).getByRole('link', { name: 'AI help' })).toHaveAttribute('aria-current', 'page')

  const form = page.getByRole('form', { name: 'Write drafts' })
  await form.getByLabel('Description', { exact: true }).uncheck()
  await form.getByRole('button', { name: 'Write drafts' }).click()
  const progress = page.getByTestId('batch-progress')
  await expect(progress).toContainText('Finished. 2 of 2 products done', { timeout: 10_000 })
  expect(calls.batches).toEqual([{ subject: 'product', missing: ['description'], fields: ['short_description', 'seo_title', 'seo_description'], languages: ['en'], tone: 'friendly', length: 'medium' }])
  await expectNoPageOverflow(page)

  // Review: edit the SEO title and approve.
  await page.getByRole('button', { name: 'Review Baby Romper (English)' }).click()
  const sheet = page.getByRole('dialog', { name: 'Baby Romper' })
  const seo = sheet.getByTestId('review-field-seo_title')
  await seo.getByLabel('Written by AI').fill('Soft cotton Baby Romper')
  await expect(seo).toContainText('23 / 70 characters')
  await expect(sheet).toContainText('size range')
  await sheet.getByRole('button', { name: 'Approve' }).click()
  await expect(sheet).toHaveCount(0)
  expect(calls.approvals[0]).toEqual({ fields: { short_description: 'A soft cotton romper for everyday play.', seo_title: 'Soft cotton Baby Romper' } })

  // A draft whose listing changed: the warning, then "Approve anyway".
  await page.getByRole('button', { name: 'Review Berry Basics (Bangla)' }).click()
  const stale = page.getByRole('dialog', { name: 'Berry Basics' })
  await expect(stale.getByTestId('stale-warning')).toContainText('This text changed since the draft was written')
  await stale.getByRole('button', { name: 'Approve anyway' }).click()
  await expect(stale).toHaveCount(0)
  expect(calls.approvals[1]).toEqual({ fields: { seo_title: 'বেরি বেসিকস' }, force: true })

  // Bulk approve the waiting ones.
  await page.getByRole('checkbox', { name: 'Select Baby Romper (English)' }).check()
  await page.getByRole('button', { name: 'Approve selected' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Approve' }).click()
  await expect.poll(() => calls.approveMany).toEqual([{ ids: ['d-1'] }])
})

test('suggests categories with confidence in words and applies them', async ({ page }) => {
  const calls = await mockBackend(page)
  await page.goto('/admin/storefront/ai?tab=categories')
  await page.getByRole('button', { name: 'Suggest categories' }).click()
  const table = page.getByRole('table', { name: 'Category suggestions' })
  await expect(table.getByTestId('suggestion-p-1').getByTestId('confidence')).toContainText('High')
  await expect(table.getByTestId('suggestion-p-2').getByTestId('confidence')).toContainText('Low')
  await page.getByRole('button', { name: 'Apply all high-confidence (1)' }).click()
  await expect(table.getByTestId('suggestion-p-1')).toContainText('Applied')
  await table.getByRole('button', { name: 'Skip Cotton Socks' }).click()
  await expect(table.getByTestId('suggestion-p-2')).toContainText('Skipped')
  expect(calls.applies).toEqual([{ items: [{ product_id: 'p-1', category_id: 'c-1' }] }])
  await expectNoPageOverflow(page)
})

test('describes a bundle idea with AI and adds it to frequently bought together', async ({ page }) => {
  const calls = await mockBackend(page)
  await page.goto('/admin/storefront/ai?tab=bundles')
  const card = page.getByTestId('bundle-p-1')
  await expect(card).toContainText('Bought together in 12 orders')
  await card.getByRole('button', { name: 'Describe with AI' }).click()
  await expect(card.getByTestId('bundle-text')).toContainText('Cosy baby set')
  await expect(card.getByTestId('bundle-text')).toContainText('আরামদায়ক বেবি সেট')
  await card.getByRole('button', { name: 'Add to frequently bought together' }).click()
  await expect.poll(() => calls.bundleApplies).toEqual([{ anchor_id: 'p-1', product_ids: ['p-2'] }])
  await expectNoPageOverflow(page)
})

test('"Write AI drafts" on the products list prefills the chosen products', async ({ page }) => {
  const calls = await mockBackend(page)
  await page.goto('/admin/products')
  await page.getByRole('checkbox', { name: 'Select Cotton Socks' }).check()
  await page.getByRole('button', { name: 'Write AI drafts' }).click()
  await expect(page).toHaveURL(/\/admin\/storefront\/ai\?tab=drafts$/)
  const form = page.getByRole('form', { name: 'Write drafts' })
  await expect(form.getByRole('list', { name: 'Chosen products' })).toContainText('Cotton Socks')
  await form.getByRole('button', { name: 'Write drafts' }).click()
  await expect.poll(() => calls.batches).toEqual([expect.objectContaining({ subject: 'product', ids: ['p-2'] })])
})
