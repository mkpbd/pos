import { expect, test, type Page } from '@playwright/test'

/**
 * AI2b Online store → Assistant against a mocked API (desktop + mobile projects): the tab only
 * while AI is on, the 30-day note, saving the settings through PATCH /storefront/settings
 * `assistant`, the summary cards, filtering the chats and reading a transcript with the lookups
 * used per reply. No AI provider is called.
 */

const envelope = (data: unknown, meta: Record<string, unknown> = {}) => ({ success: true, data, meta: { request_id: 'e2e', ...meta } })
const paged = (items: unknown[], meta: Record<string, unknown> = {}) => envelope(items, { pagination: { current_page: 1, per_page: 20, total: items.length, last_page: 1 }, ...meta })

const meFor = (aiEnabled: boolean) => ({
  user: { id: 'u-1', name: 'Nadia Admin', email: 'nadia@berry.test', phone: null, is_platform_admin: false, last_login_at: null },
  organization: { id: 'o-1', name: 'Berry Kids', slug: 'berry-kids', base_currency: 'BDT', timezone: 'Asia/Dhaka', tax_mode: 'exclusive', status: 'active' },
  roles: [{ id: 'r-1', name: 'Organization Admin', system_key: 'organization_admin' }],
  permissions: ['branches.view', 'storefront.view', 'storefront.manage'],
  branches: [{ id: 'b-1', code: 'MAIN', name: 'Main Branch', is_active: true }],
  ai_enabled: aiEnabled,
})

const settings = (assistant: Record<string, unknown>) => ({
  is_enabled: true, site_name: 'Berry Kids', meta_description: null, fulfilment_store_id: null, whatsapp_number: '8801712345678', updated_at: '2026-11-20T10:00:00Z', assistant,
})

const chat = (over: Record<string, unknown> = {}) => ({
  id: 'c-1', started_at: '2026-11-20T08:00:00Z', last_message_at: '2026-11-20T08:05:00Z', language: 'en', signed_in: false, customer_name: null,
  message_count: 2, handed_off: false, status: 'closed', preview: 'How much is delivery to Sylhet?', ...over,
})

async function mockBackend(page: Page, { aiEnabled = true }: { aiEnabled?: boolean } = {}) {
  const patches: unknown[] = []
  const listQueries: URLSearchParams[] = []
  let assistant: Record<string, unknown> = { enabled: false, name: 'Shop assistant', greeting: null, daily_conversation_limit: 200, handoff: 'whatsapp', translations: { bn: { greeting: null } } }
  await page.addInitScript(() => localStorage.setItem('pos-session', JSON.stringify({ state: { activeBranchId: 'b-1' }, version: 0 })))
  await page.route('**/api/v1/**', (route) => route.fulfill({ json: paged([]) }))
  await page.route('**/sanctum/csrf-cookie', (route) => route.fulfill({ status: 204, headers: { 'Set-Cookie': 'XSRF-TOKEN=e2e; Path=/' } }))
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({ json: envelope(meFor(aiEnabled)) }))
  await page.route('**/api/v1/notifications/unread-count', (route) => route.fulfill({ json: envelope({ count: 0 }) }))
  await page.route((url) => url.pathname === '/api/v1/storefront/settings', (route) => {
    if (route.request().method() === 'PATCH') {
      const body = route.request().postDataJSON() as { assistant: Record<string, unknown> }
      patches.push(body)
      assistant = { ...assistant, ...body.assistant }
      return route.fulfill({ json: envelope({ ...settings(assistant), updated_at: '2026-11-20T11:00:00Z' }) })
    }
    return route.fulfill({ json: envelope(settings(assistant)) })
  })
  await page.route((url) => url.pathname === '/api/v1/storefront/assistant/summary', (route) =>
    route.fulfill({ json: envelope({ conversations: 8, messages: 30, handed_off: 2, handed_off_share: 0.25, unavailable: 0, limit: 1, budget: 0, top_tools: [{ name: 'store_policies', count: 9 }, { name: 'search_products', count: 4 }] }) }),
  )
  await page.route((url) => url.pathname === '/api/v1/storefront/assistant/conversations', (route) => {
    const query = new URL(route.request().url()).searchParams
    listQueries.push(query)
    const rows = [chat(), chat({ id: 'c-2', language: 'bn', signed_in: true, handed_off: true, preview: 'আমার অর্ডার কোথায়?' })]
    return route.fulfill({ json: paged(query.get('handed_off') === '1' ? rows.filter((r) => r.handed_off) : rows) })
  })
  await page.route('**/api/v1/storefront/assistant/conversations/c-1', (route) =>
    route.fulfill({
      json: envelope({
        ...chat(),
        messages: [
          { id: 'm-1', role: 'user', text: 'How much is delivery to Sylhet?', tools: [], status: 'ok', created_at: '2026-11-20T08:00:00Z' },
          { id: 'm-2', role: 'assistant', text: 'Delivery outside Dhaka costs ৳120 and takes 3–5 days.', tools: ['store_policies'], status: 'ok', created_at: '2026-11-20T08:00:04Z' },
        ],
      }),
    }),
  )
  return { patches, listQueries }
}

test('the Assistant tab appears only while AI is on', async ({ page }) => {
  await mockBackend(page, { aiEnabled: false })
  await page.goto('/admin/storefront/assistant')
  await expect(page.getByText('The shop assistant needs AI')).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Online store sections' }).getByRole('link', { name: 'Assistant' })).toHaveCount(0)
})

test('saves the assistant settings', async ({ page }) => {
  const { patches } = await mockBackend(page)
  await page.goto('/admin/storefront')
  await page.getByRole('navigation', { name: 'Online store sections' }).getByRole('link', { name: 'Assistant' }).click()
  await expect(page).toHaveURL(/\/admin\/storefront\/assistant$/)
  await expect(page.getByText('Conversations are kept for 30 days.')).toBeVisible()

  const form = page.getByRole('form', { name: 'Assistant settings' })
  await form.getByRole('switch', { name: 'Show the assistant on my store' }).click()
  await form.getByLabel('Assistant name').fill('Mitu')
  await form.getByLabel('Greeting', { exact: true }).fill('Hi! Ask me about sizes, delivery or returns.')
  await form.getByLabel('Greeting in Bangla').fill('হ্যালো! সাইজ, ডেলিভারি বা রিটার্ন নিয়ে জিজ্ঞেস করুন।')
  await form.getByLabel('New chats per day').fill('120')
  await form.getByRole('button', { name: 'Save assistant settings' }).click()

  await expect(page.getByText('Assistant settings saved. Shoppers can chat with it on your store.')).toBeVisible()
  expect(patches).toEqual([
    {
      assistant: {
        enabled: true,
        name: 'Mitu',
        greeting: 'Hi! Ask me about sizes, delivery or returns.',
        daily_conversation_limit: 120,
        handoff: 'whatsapp',
        translations: { bn: { greeting: 'হ্যালো! সাইজ, ডেলিভারি বা রিটার্ন নিয়ে জিজ্ঞেস করুন।' } },
      },
    },
  ])
  await expect(page.getByTestId('assistant-state')).toHaveText('On')
  await expect(form.getByRole('button', { name: 'Save assistant settings' })).toBeDisabled()
})

test('shows the summary, filters the chats and reads a transcript', async ({ page }) => {
  const { listQueries } = await mockBackend(page)
  await page.goto('/admin/storefront/assistant')

  const summary = page.getByTestId('assistant-summary')
  await expect(summary.getByText('25%')).toBeVisible()
  await expect(summary.getByText('Store policies')).toBeVisible()

  const table = page.getByRole('table', { name: 'Assistant chats' })
  await expect(table.getByTestId('chat-c-1')).toBeVisible()
  // No sideways scrolling of the page itself (the table scrolls inside its own box on phones).
  expect(await page.evaluate<number>('document.documentElement.scrollWidth - document.documentElement.clientWidth')).toBeLessThanOrEqual(0)
  await page.getByRole('combobox', { name: 'Filter by hand-off' }).click()
  await page.getByRole('option', { name: 'Handed off', exact: true }).click()
  await expect(table.getByTestId('chat-c-1')).toHaveCount(0)
  await expect(table.getByTestId('chat-c-2')).toBeVisible()
  expect(listQueries.at(-1)?.get('handed_off')).toBe('1')

  await page.getByRole('combobox', { name: 'Filter by hand-off' }).click()
  await page.getByRole('option', { name: 'All chats' }).click()
  await table.getByTestId('chat-c-1').getByRole('button', { name: /Read the chat/ }).click()
  const drawer = page.getByRole('dialog')
  await expect(drawer.getByText('Delivery outside Dhaka costs ৳120 and takes 3–5 days.')).toBeVisible()
  await expect(drawer.getByRole('list', { name: 'Lookups used for this reply' }).getByText('Store policies')).toBeVisible()
  await expect(drawer.getByText('Guest', { exact: false }).first()).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(drawer).toHaveCount(0)
})
