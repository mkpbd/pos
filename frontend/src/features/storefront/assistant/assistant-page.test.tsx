import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { routes } from '@/app/routes'
import { makeCurrentUser } from '@/test/fixtures'
import { fail, mockApi, ok, renderRoutes } from '@/test/utils'
import { assistantProblems, normalizeConversation, normalizeSummary, normalizeTranscript, readAssistantSettings, toAssistantInput, toolLabel } from './model'

/*
 * AI2b Online store → Assistant: the tab (AI on + storefront.manage only), the AI-off note, the
 * settings card (defaults, checks, save through PATCH /storefront/settings `assistant`, server
 * errors), summary cards, the chats list (filters as query parameters, names only when sent) and
 * the transcript drawer (lookups per reply, standard replies), plus the normalizers.
 */

const toastSuccess = vi.hoisted(() => vi.fn())
vi.mock('sonner', async (importOriginal) => {
  const original = await importOriginal<typeof import('sonner')>()
  return { ...original, toast: Object.assign(vi.fn(), { ...original.toast, success: toastSuccess, error: vi.fn(), message: vi.fn() }) }
})
beforeEach(() => toastSuccess.mockReset())

const MANAGER = ['storefront.view', 'storefront.manage']
const user = (permissions = MANAGER, ai_enabled = true) => makeCurrentUser({ permissions, ai_enabled })
const page = (total: number) => ({ pagination: { current_page: 1, per_page: 20, total, last_page: 1 } })

const settings = (assistant: unknown = { enabled: false, name: 'Shop assistant', greeting: null, daily_conversation_limit: 200, handoff: 'whatsapp', translations: { bn: { greeting: null } } }, over: Record<string, unknown> = {}) => ({
  is_enabled: true, site_name: 'Corner Shop', meta_description: null, fulfilment_store_id: null, whatsapp_number: '8801712345678', updated_at: '2026-11-20T10:00:00Z', assistant, ...over,
})

const summary = { conversations: 12, messages: 48, handed_off: 3, handed_off_share: 0.25, unavailable: 1, limit: 2, budget: 0, top_tools: [{ name: 'search_products', count: 20 }, { name: 'store_policies', count: 7 }] }

const chat = (over: Record<string, unknown> = {}) => ({
  id: 'c-1', started_at: '2026-11-20T08:00:00Z', last_message_at: '2026-11-20T08:05:00Z', language: 'en', signed_in: false, customer_name: null,
  message_count: 4, handed_off: false, status: 'closed', preview: 'What is the delivery charge to Sylhet?', ...over,
})

const transcript = {
  ...chat(),
  messages: [
    { id: 'm-1', role: 'user', text: 'What is the delivery charge to Sylhet?', tools: [], status: 'ok', created_at: '2026-11-20T08:00:00Z' },
    { id: 'm-2', role: 'assistant', text: 'Delivery outside Dhaka is ৳120 and takes 3–5 days.', tools: ['store_policies', 'store_policies', 'search_help'], status: 'ok', created_at: '2026-11-20T08:00:05Z' },
    { id: 'm-3', role: 'user', text: 'Any offers?', tools: [], status: 'ok', created_at: '2026-11-20T08:04:00Z' },
    { id: 'm-4', role: 'assistant', text: 'Sorry, I cannot answer right now. Chat with us on WhatsApp.', tools: [], status: 'budget', created_at: '2026-11-20T08:04:02Z' },
  ],
}

const base = (over: Record<string, unknown> = {}) => ({
  'GET /auth/me': ok(user()),
  'GET /storefront/settings': ok(settings()),
  'GET /storefront/assistant/summary': ok(summary),
  'GET /storefront/assistant/conversations': ok([chat(), chat({ id: 'c-2', language: 'bn', signed_in: true, handed_off: true, preview: 'আমার অর্ডার কোথায়?' })], page(2)),
  ...over,
})

const callsTo = (fetchMock: ReturnType<typeof mockApi>, method: string, path: string) =>
  fetchMock.mock.calls.filter(([url, init]) => new URL(String(url), 'http://localhost').pathname.endsWith(path) && (init?.method ?? 'GET') === method)

const bodyOf = (fetchMock: ReturnType<typeof mockApi>, method: string, path: string) =>
  callsTo(fetchMock, method, path).map(([, init]) => JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>)

const lastQuery = (fetchMock: ReturnType<typeof mockApi>, path: string) => {
  const calls = callsTo(fetchMock, 'GET', path)
  return new URL(String(calls[calls.length - 1]![0]), 'http://localhost').searchParams
}

describe('Assistant tab and page', () => {
  it('shows the Assistant tab with AI on and storefront.manage, with the 30-day note', async () => {
    mockApi(base())
    renderRoutes(routes, '/storefront/assistant')
    expect(await screen.findByRole('link', { name: 'Assistant' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByText(/Conversations are kept for 30 days\./)).toBeInTheDocument()
    expect(await screen.findByRole('form', { name: 'Assistant settings' })).toBeInTheDocument()
  })

  it('hides the tab while AI is off and explains it on the page', async () => {
    mockApi(base({ 'GET /auth/me': ok(user(MANAGER, false)) }))
    renderRoutes(routes, '/storefront/assistant')
    expect(await screen.findByText('The shop assistant needs AI')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Assistant' })).not.toBeInTheDocument()
    expect(screen.queryByRole('form', { name: 'Assistant settings' })).not.toBeInTheDocument()
  })

  it('hides the tab without storefront.manage and guards the page', async () => {
    mockApi(base({ 'GET /auth/me': ok(user(['storefront.view'])) }))
    renderRoutes(routes, '/storefront')
    expect(await screen.findByRole('link', { name: 'Settings & domains' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Assistant' })).not.toBeInTheDocument()
  })
})

describe('Assistant settings', () => {
  it('saves every field under `assistant`, the Bangla greeting as translations.bn.greeting', async () => {
    const fetchMock = mockApi(
      base({
        'PATCH /storefront/settings': (init: RequestInit) => {
          const body = JSON.parse(String(init.body)) as { assistant: Record<string, unknown> }
          return ok(settings({ ...body.assistant }, { updated_at: '2026-11-20T11:00:00Z' }))
        },
      }),
    )
    renderRoutes(routes, '/storefront/assistant')
    const form = await screen.findByRole('form', { name: 'Assistant settings' })
    const ui = within(form)
    expect(ui.getByRole('switch', { name: 'Show the assistant on my store' })).not.toBeChecked()
    expect(ui.getByLabelText('Assistant name')).toHaveValue('Shop assistant')
    expect(ui.getByLabelText('New chats per day')).toHaveValue(200)
    expect(ui.getByRole('radio', { name: 'WhatsApp chat' })).toBeChecked()
    expect(ui.getByRole('button', { name: 'Save assistant settings' })).toBeDisabled()

    await userEvent.click(ui.getByRole('switch', { name: 'Show the assistant on my store' }))
    await userEvent.clear(ui.getByLabelText('Assistant name'))
    await userEvent.type(ui.getByLabelText('Assistant name'), 'Mitu')
    await userEvent.type(ui.getByLabelText('Greeting'), 'Hi! Ask me anything.')
    await userEvent.type(ui.getByLabelText('Greeting in Bangla'), 'হ্যালো!')
    await userEvent.clear(ui.getByLabelText('New chats per day'))
    await userEvent.type(ui.getByLabelText('New chats per day'), '50')
    await userEvent.click(ui.getByRole('radio', { name: 'Contact page' }))
    await userEvent.click(ui.getByRole('button', { name: 'Save assistant settings' }))

    await waitFor(() => expect(bodyOf(fetchMock, 'PATCH', '/storefront/settings')).toHaveLength(1))
    expect(bodyOf(fetchMock, 'PATCH', '/storefront/settings')[0]).toEqual({
      assistant: { enabled: true, name: 'Mitu', greeting: 'Hi! Ask me anything.', daily_conversation_limit: 50, handoff: 'contact', translations: { bn: { greeting: 'হ্যালো!' } } },
    })
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Assistant settings saved. Shoppers can chat with it on your store.'))
  })

  it('checks the limits before saving and shows server field errors', async () => {
    const fetchMock = mockApi(base({ 'PATCH /storefront/settings': fail(422, 'VALIDATION_FAILED', 'Invalid', { 'assistant.translations.bn.greeting': ['The Bangla greeting is too long.'] }) }))
    renderRoutes(routes, '/storefront/assistant')
    const ui = within(await screen.findByRole('form', { name: 'Assistant settings' }))
    await userEvent.clear(ui.getByLabelText('Assistant name'))
    await userEvent.clear(ui.getByLabelText('New chats per day'))
    await userEvent.type(ui.getByLabelText('New chats per day'), '5000')
    await userEvent.click(ui.getByRole('button', { name: 'Save assistant settings' }))
    expect(ui.getByText('Give the assistant a name.')).toBeInTheDocument()
    expect(ui.getByText('Enter a whole number from 1 to 2000.')).toBeInTheDocument()
    expect(ui.getByLabelText('Assistant name')).toHaveAttribute('aria-invalid', 'true')
    expect(callsTo(fetchMock, 'PATCH', '/storefront/settings')).toHaveLength(0)

    await userEvent.type(ui.getByLabelText('Assistant name'), 'Mitu')
    await userEvent.clear(ui.getByLabelText('New chats per day'))
    await userEvent.type(ui.getByLabelText('New chats per day'), '100')
    await userEvent.click(ui.getByRole('button', { name: 'Save assistant settings' }))
    expect(await ui.findByText('The Bangla greeting is too long.')).toBeInTheDocument()
  })

  it('offers WhatsApp only when the store has a WhatsApp number', async () => {
    mockApi(base({ 'GET /storefront/settings': ok(settings({ enabled: true, name: 'Shop assistant', greeting: 'Hello', daily_conversation_limit: 200, handoff: 'contact' }, { whatsapp_number: null })) }))
    renderRoutes(routes, '/storefront/assistant')
    const ui = within(await screen.findByRole('form', { name: 'Assistant settings' }))
    expect(ui.getByRole('radio', { name: 'WhatsApp chat' })).toBeDisabled()
    expect(ui.getByRole('radio', { name: 'Contact page' })).toBeChecked()
    expect(ui.getByText(/Add a WhatsApp number under Settings & domains/)).toBeInTheDocument()
  })
})

describe('Assistant summary and chats', () => {
  it('shows the summary cards for the last 30 days', async () => {
    const fetchMock = mockApi(base())
    renderRoutes(routes, '/storefront/assistant')
    const cards = await screen.findByTestId('assistant-summary')
    expect(within(cards).getByText('12')).toBeInTheDocument()
    expect(within(cards).getByText('48 messages')).toBeInTheDocument()
    expect(within(cards).getByText('25%')).toBeInTheDocument()
    expect(within(cards).getByText('1 AI unavailable · 2 limit reached')).toBeInTheDocument()
    expect(within(cards).getByText('Searched products')).toBeInTheDocument()
    const query = lastQuery(fetchMock, '/storefront/assistant/summary')
    expect(query.get('from')).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(query.get('to')).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('lists chats without names unless the API sends them, and filters through the query', async () => {
    const fetchMock = mockApi(base())
    renderRoutes(routes, '/storefront/assistant')
    const table = await screen.findByRole('table', { name: 'Assistant chats' })
    const first = within(table).getByTestId('chat-c-1')
    expect(within(first).getAllByText('Guest').length).toBeGreaterThan(0)
    const second = within(table).getByTestId('chat-c-2')
    expect(within(second).getAllByText('Signed-in shopper').length).toBeGreaterThan(0)
    expect(within(second).getByText('Yes')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('combobox', { name: 'Filter by hand-off' }))
    await userEvent.click(await screen.findByRole('option', { name: 'Handed off' }))
    await waitFor(() => expect(lastQuery(fetchMock, '/storefront/assistant/conversations').get('handed_off')).toBe('1'))

    await userEvent.type(screen.getByRole('searchbox', { name: 'Search chats' }), 'Sylhet')
    await waitFor(() => expect(lastQuery(fetchMock, '/storefront/assistant/conversations').get('search')).toBe('Sylhet'))

    const from = screen.getByLabelText('From')
    await userEvent.clear(from)
    await userEvent.type(from, '2026-11-01')
    await waitFor(() => expect(lastQuery(fetchMock, '/storefront/assistant/conversations').get('from')).toBe('2026-11-01'))
    await waitFor(() => expect(lastQuery(fetchMock, '/storefront/assistant/summary').get('from')).toBe('2026-11-01'))
  })

  it('shows the customer name when the API sends it', async () => {
    mockApi(base({ 'GET /storefront/assistant/conversations': ok([chat({ signed_in: true, customer_name: 'Ayesha Rahman' })], page(1)) }))
    renderRoutes(routes, '/storefront/assistant')
    const table = await screen.findByRole('table', { name: 'Assistant chats' })
    expect(within(table).getAllByText('Ayesha Rahman').length).toBeGreaterThan(0)
  })

  it('opens the transcript with the lookups per reply and the standard-reply reason', async () => {
    mockApi(base({ 'GET /storefront/assistant/conversations/c-1': ok(transcript) }))
    renderRoutes(routes, '/storefront/assistant')
    const table = await screen.findByRole('table', { name: 'Assistant chats' })
    await userEvent.click(within(within(table).getByTestId('chat-c-1')).getByRole('button', { name: /Read the chat/ }))
    const drawer = await screen.findByRole('dialog')
    expect(await within(drawer).findByText('Delivery outside Dhaka is ৳120 and takes 3–5 days.')).toBeInTheDocument()
    const reply = within(drawer).getByTestId('message-m-2')
    const lookups = within(reply).getByRole('list', { name: 'Lookups used for this reply' })
    expect(within(lookups).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Store policies', 'Help pages and FAQ'])
    expect(within(within(drawer).getByTestId('message-m-4')).getByText('AI allowance used up')).toBeInTheDocument()
    expect(within(within(drawer).getByTestId('message-m-1')).getByText('Shopper')).toBeInTheDocument()
  })

  it('says so when there are no chats yet', async () => {
    mockApi(base({ 'GET /storefront/assistant/conversations': ok([], page(0)) }))
    renderRoutes(routes, '/storefront/assistant')
    expect(await screen.findByText('No chats in these days')).toBeInTheDocument()
  })
})

describe('assistant model', () => {
  it('reads settings with defaults and the Bangla greeting from any shape', () => {
    expect(readAssistantSettings(undefined, true)).toEqual({ enabled: false, name: 'Shop assistant', greeting: '', greeting_bn: '', daily_conversation_limit: 200, handoff: 'whatsapp' })
    expect(readAssistantSettings(null, false).handoff).toBe('contact')
    expect(readAssistantSettings({ greeting: 'Hi', translations: { bn: { greeting: 'হাই' } } }, true)).toMatchObject({ greeting: 'Hi', greeting_bn: 'হাই' })
    expect(readAssistantSettings({ greeting: { en: 'Hi', bn: 'হাই' } }, true)).toMatchObject({ greeting: 'Hi', greeting_bn: 'হাই' })
    expect(readAssistantSettings({ greeting_bn: 'হাই' }, true).greeting_bn).toBe('হাই')
  })

  it('writes an empty greeting as null and checks the limits', () => {
    const values = { enabled: true, name: ' Mitu ', greeting: '  ', greeting_bn: '', daily_conversation_limit: 10, handoff: 'none' as const }
    expect(toAssistantInput(values)).toEqual({ enabled: true, name: 'Mitu', greeting: null, daily_conversation_limit: 10, handoff: 'none', translations: { bn: { greeting: '' } } })
    expect(assistantProblems(values, false)).toEqual({})
    expect(assistantProblems({ ...values, name: 'x'.repeat(41), greeting: 'y'.repeat(201), daily_conversation_limit: 0, handoff: 'whatsapp' }, false)).toEqual({
      name: 'Use at most 40 characters.',
      greeting: 'Use at most 200 characters.',
      daily_conversation_limit: 'Enter a whole number from 1 to 2000.',
      handoff: expect.stringContaining('no WhatsApp number'),
    })
  })

  it('normalizes rows, transcripts and summaries defensively', () => {
    expect(normalizeConversation({ id: 'c', preview: 'x'.repeat(100) }).preview).toHaveLength(80)
    expect(normalizeConversation({ id: 'c', customer_name: 'A' })).toMatchObject({ signed_in: true, customer_name: 'A', language: 'en' })
    expect(normalizeTranscript({ conversation: { id: 'c' }, messages: [{ id: 'm', role: 'assistant', tools: [{ name: 'get_product' }, 'search_help'], status: 'limit' }] }).messages[0]).toMatchObject({ tools: ['get_product', 'search_help'], status: 'limit' })
    expect(normalizeSummary({ conversations: 4, handed_off: 1, handed_off_share: 0.25 }).handed_off_percent).toBe(25)
    expect(normalizeSummary({ handed_off_share: '12.5%' }).handed_off_percent).toBe(13)
    expect(normalizeSummary({ conversations: 10, handed_off: 3 }).handed_off_percent).toBe(30)
    expect(normalizeSummary({ top_tools: { a: 1, b: 5 } }).top_tools).toEqual([{ name: 'b', count: 5 }, { name: 'a', count: 1 }])
    expect(toolLabel('order_status')).toBe('Order status')
    expect(toolLabel('new_tool')).toBe('New tool')
  })
})
