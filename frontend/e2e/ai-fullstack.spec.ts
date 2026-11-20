import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { expect as baseExpect, test, type Page } from '@playwright/test'

const expect = baseExpect.configure({ timeout: 15_000 })

/**
 * AI2a full-stack: staff catalog writing against a real backend whose AI provider is the Fake
 * (schema-synthesized answers such as "Sample short_description"). Opt-in: start the backend with
 * E2E_AI=true (AI_PROVIDER=fake, DEMOS=1 for AI2b) and run with E2E_BACKEND=1 E2E_AI=1 (E2E_DEMOS=1).
 */
test.skip(!process.env.E2E_BACKEND || !process.env.E2E_AI, 'Set E2E_BACKEND=1 E2E_AI=1 against a backend started with E2E_AI=true (Fake AI provider)')
test.describe.configure({ mode: 'serial', timeout: 180_000 })

type Api = { status: number; body: { data: any; error?: any; meta?: any } }

async function call(page: Page, method: string, url: string, body?: unknown): Promise<Api> {
  const token = decodeURIComponent((await page.context().cookies()).find((c) => c.name === 'XSRF-TOKEN')?.value ?? '')
  return page.evaluate(
    async ({ method, url, body, token }) => {
      const res = await fetch(url, { method, credentials: 'include', headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-XSRF-TOKEN': token }, body: body === undefined ? undefined : JSON.stringify(body) })
      return { status: res.status, body: (await res.json().catch(() => null)) as { data: any; error?: any; meta?: any } }
    },
    { method, url, body, token },
  )
}

async function signIn(page: Page) {
  await page.goto('/admin/login')
  await page.getByLabel('E-mail').fill('owner@demo.test')
  await page.getByLabel('Password').fill('password')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible()
}

test('AI2a: write a listing with AI, approve AI drafts, apply a category suggestion, use a bundle idea', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile-chromium', 'The admin flow runs on desktop')
  await page.setViewportSize({ width: 1600, height: 1000 })
  await signIn(page)
  expect((await call(page, 'PATCH', '/api/v1/ai/settings', { enabled: true })).status).toBe(200)
  await page.reload()
  expect((await call(page, 'GET', '/api/v1/auth/me')).body.data.ai_enabled).toBe(true)

  const products = (await call(page, 'GET', '/api/v1/products?per_page=5')).body.data as { id: string; name: string }[]
  const product = products[0]!

  // 1. Write with AI on the product's online listing → the form fills, saving stores the texts.
  await page.goto(`/admin/products/${product.id}/online-store`)
  const form = page.getByRole('form', { name: 'Online listing' })
  await form.getByRole('button', { name: 'Write with AI: descriptions' }).click()
  const dialog = page.getByRole('dialog', { name: 'Write with AI' })
  await dialog.getByRole('radio', { name: 'Both' }).check()
  await dialog.getByRole('button', { name: 'Write', exact: true }).click()
  await expect(dialog.getByText('Sample short_description').first()).toBeVisible({ timeout: 30_000 })
  // Make sure the English short description is used even if the listing already had one.
  const useShort = dialog.getByRole('checkbox', { name: 'Use for Short description (English)' })
  if (!(await useShort.isChecked())) await useShort.check()
  await dialog.getByRole('button', { name: /^Use selected/ }).click()
  await expect(dialog).toBeHidden()
  await form.getByRole('button', { name: 'Save online listing' }).click()
  await expect
    .poll(async () => (await call(page, 'GET', `/api/v1/online-catalog/products/${product.id}`)).body.data.listing.short_description)
    .toBe('Sample short_description')

  // 2. AI drafts for products missing search-engine texts: written at once (sync queue), reviewed, approved.
  const batch = await call(page, 'POST', '/api/v1/online-catalog/ai/batches', { subject: 'product', ids: products.slice(1, 4).map((p) => p.id), fields: ['seo_title', 'seo_description'], languages: ['en'] })
  expect(batch.status).toBe(201)
  expect(batch.body.data.status).toBe('done')
  expect(batch.body.data.drafts.pending).toBeGreaterThan(0)
  await page.goto('/admin/storefront/ai?tab=drafts')
  await expect(page.getByRole('navigation', { name: 'Online store sections' }).getByRole('link', { name: 'AI help' })).toHaveAttribute('aria-current', 'page')
  const target = products[1]!
  await page.getByRole('button', { name: `Review ${target.name} (English)` }).click()
  const sheet = page.getByRole('dialog', { name: target.name })
  await sheet.getByRole('button', { name: 'Approve' }).click()
  await expect(sheet).toBeHidden()
  await expect
    .poll(async () => (await call(page, 'GET', `/api/v1/online-catalog/products/${target.id}`)).body.data.listing.seo_title)
    .toBe('Sample seo_title')
  const drafts = await call(page, 'GET', `/api/v1/online-catalog/ai/drafts?batch_id=${batch.body.data.id}&status=approved`)
  expect((drafts.body.data as { subject_id: string }[]).map((d) => d.subject_id)).toContain(target.id)

  // 3. Category suggestions: the model can only pick a real category; applying changes the product.
  const suggested = await call(page, 'POST', '/api/v1/online-catalog/ai/category-suggestions', { product_ids: [products[4]!.id] })
  expect(suggested.status).toBe(200)
  const suggestion = suggested.body.data.suggestions[0] as { product: { id: string }; category: { id: string; path: string } | null; confidence: string }
  expect(suggestion.product.id).toBe(products[4]!.id)
  expect(suggestion.category).not.toBeNull()
  const applied = await call(page, 'POST', '/api/v1/online-catalog/ai/category-suggestions/apply', { items: [{ product_id: suggestion.product.id, category_id: suggestion.category!.id }] })
  expect(applied.status).toBe(200)
  expect([...applied.body.data.applied, ...applied.body.data.skipped.filter((s: { reason: string }) => s.reason === 'unchanged').map((s: { product_id: string }) => s.product_id)]).toContain(suggestion.product.id)
  await page.goto('/admin/storefront/ai?tab=categories')
  await expect(page.getByRole('button', { name: 'Suggest categories' })).toBeVisible()

  // 4. Bundle ideas from the nightly co-purchase run; "Describe with AI" and adding to frequently bought together.
  const backend = fileURLToPath(new URL('../../backend', import.meta.url))
  execFileSync(process.env.E2E_PHP ?? 'php', ['artisan', 'pos:affinities:compute'], {
    cwd: backend,
    env: { ...process.env, DB_CONNECTION: 'pgsql', DB_DATABASE: process.env.E2E_DB_DATABASE ?? 'pos_e2e', CACHE_STORE: 'database', QUEUE_CONNECTION: 'sync', MAIL_MAILER: 'log' },
  })
  const ideas = await call(page, 'GET', '/api/v1/online-catalog/bundle-ideas')
  expect(ideas.status).toBe(200)
  expect(ideas.body.meta.last_run).not.toBeNull()
  await page.goto('/admin/storefront/ai?tab=bundles')
  const first = (ideas.body.data as { anchor: { id: string; name: string }; products: { id: string }[] }[])[0]
  if (first) {
    const described = await call(page, 'POST', '/api/v1/online-catalog/bundle-ideas/describe', { anchor_id: first.anchor.id, product_ids: [first.products[0]!.id] })
    expect(described.status).toBe(200)
    expect(described.body.data.title).toBeTruthy()
    const added = await call(page, 'POST', '/api/v1/online-catalog/bundle-ideas/apply', { anchor_id: first.anchor.id, product_ids: [first.products[0]!.id] })
    expect(added.status).toBe(200)
    expect((added.body.data.frequently_bought as { id: string }[]).map((p) => p.id)).toContain(first.products[0]!.id)
  } else {
    // The seeded store has no orders with two products yet: the page explains the empty state.
    await expect(page.getByRole('tabpanel')).toBeVisible()
  }

  // The usage log names the new features (AI settings → usage).
  const usage = JSON.stringify((await call(page, 'GET', '/api/v1/ai/usage')).body.data)
  expect(usage).toContain('catalog_writer')
  expect(usage).toContain('catalog_drafts')
})

test('AI2b: the owner switches the shop assistant on; a shopper chats on the store; staff read the chat', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile-chromium', 'The admin flow runs on desktop')
  test.skip(!process.env.E2E_DEMOS, 'Needs the demo stores (backend started with DEMOS=1)')
  const base = `http://vegan.shop.localhost:${Number(process.env.E2E_PORT ?? 5173)}`
  const adminContext = await browser.newContext({ viewport: { width: 1600, height: 1000 } })
  const admin = await adminContext.newPage()
  await admin.goto(`${base}/admin/login`)
  await admin.getByLabel('E-mail').fill('owner@greenbasket.test')
  await admin.getByLabel('Password').fill('password')
  await admin.getByRole('button', { name: 'Sign in' }).click()
  await expect(admin.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible()
  expect((await call(admin, 'PATCH', '/api/v1/ai/settings', { enabled: true })).status).toBe(200)

  // Online store → Assistant: switch it on with a name.
  await admin.goto(`${base}/admin/storefront/assistant`)
  const form = admin.getByRole('form', { name: 'Assistant settings' })
  const toggle = form.getByRole('switch', { name: 'Show the assistant on my store' })
  if ((await toggle.getAttribute('aria-checked')) !== 'true') await toggle.click()
  await form.getByLabel('Assistant name').fill('Basket helper')
  await form.getByRole('button', { name: 'Save assistant settings' }).click()
  await expect.poll(async () => (await call(admin, 'GET', '/api/v1/storefront/settings')).body.data.assistant?.enabled).toBe(true)

  // A shopper opens the store, asks a suggested question and gets an answer (Fake provider).
  const shopperContext = await browser.newContext({ viewport: { width: 1366, height: 900 } })
  const shopper = await shopperContext.newPage()
  await shopper.goto(`${base}/`)
  await shopper.getByRole('button', { name: 'Ask Basket helper, our AI shop assistant' }).click()
  const panel = shopper.getByRole('dialog', { name: 'Basket helper' })
  await expect(panel.getByText('AI assistant — answers can be wrong')).toBeVisible()
  await panel.getByRole('button', { name: 'What is the delivery charge?' }).click()
  await expect(panel.getByTestId('assistant-messages').getByText('This is a test answer.')).toBeVisible({ timeout: 30_000 })
  // Reopening the store restores the chat from the server.
  await shopper.reload()
  await shopper.getByRole('button', { name: 'Ask Basket helper, our AI shop assistant' }).click()
  await expect(shopper.getByRole('dialog', { name: 'Basket helper' }).getByTestId('assistant-messages').getByText('This is a test answer.')).toBeVisible()

  // Staff see the chat (no personal data for a guest) and the summary counts it.
  const list = await call(admin, 'GET', '/api/v1/storefront/assistant/conversations')
  const row = (list.body.data as { id: string; signed_in: boolean; preview: string; message_count: number }[]).find((c) => c.preview.includes('delivery'))!
  expect(row.signed_in).toBe(false)
  const transcript = await call(admin, 'GET', `/api/v1/storefront/assistant/conversations/${row.id}`)
  expect((transcript.body.data.messages as { role: string; text: string }[]).map((m) => m.role)).toEqual(['user', 'assistant'])
  await admin.reload()
  await expect(admin.getByRole('table', { name: 'Assistant chats' })).toContainText('delivery')
  const usage = JSON.stringify((await call(admin, 'GET', '/api/v1/ai/usage')).body.data)
  expect(usage).toContain('store_assistant')

  // Switched off again: the button disappears from the store.
  await form.getByRole('switch', { name: 'Show the assistant on my store' }).click()
  await form.getByRole('button', { name: 'Save assistant settings' }).click()
  await expect.poll(async () => (await call(admin, 'GET', '/api/v1/storefront/settings')).body.data.assistant?.enabled).toBe(false)
  await expect.poll(async () => {
    await shopper.reload()
    return shopper.getByRole('button', { name: 'Ask Basket helper, our AI shop assistant' }).count()
  }, { timeout: 30_000 }).toBe(0)
  await shopperContext.close()
  await adminContext.close()
})
