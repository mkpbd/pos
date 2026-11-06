import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { routes } from '@/app/routes'
import { aiManager, askAnswer, customerInsights, insights } from '@/features/ai/test-data'
import { useSessionStore } from '@/stores/session-store'
import { cashier } from '@/test/fixtures'
import { fail, mockApi, ok, renderRoutes } from '@/test/utils'

beforeEach(() => useSessionStore.setState({ activeBranchId: 'b-1' }))

const askBodies = (fetchMock: ReturnType<typeof mockApi>) =>
  fetchMock.mock.calls
    .filter(([input, init]) => String(input).startsWith('/api/v1/ai/ask') && init?.method === 'POST')
    .map(([, init]) => JSON.parse(String(init?.body)) as Record<string, unknown>)

describe('AI Insights navigation', () => {
  it('shows the sidebar entry to users with ai.ask or ai.insights only', async () => {
    mockApi({ 'GET /auth/me': ok(aiManager()), 'GET /ai/insights': ok(insights()) })
    const { unmount } = renderRoutes(routes, '/ai?tab=business')
    const nav = await screen.findByRole('navigation', { name: 'Main' })
    expect(within(nav).getByRole('link', { name: 'AI Insights' })).toHaveAttribute('href', '/ai')
    unmount()

    mockApi({ 'GET /auth/me': ok(cashier()) })
    renderRoutes(routes, '/ai')
    expect(await screen.findByRole('heading', { name: 'Access denied' })).toBeInTheDocument()
    expect(within(screen.getByRole('navigation', { name: 'Main' })).queryByRole('link', { name: 'AI Insights' })).not.toBeInTheDocument()
  })

  it('shows only the Ask section to users with ai.ask alone', async () => {
    mockApi({ 'GET /auth/me': ok(aiManager({ permissions: ['branches.view', 'ai.ask'] })) })
    renderRoutes(routes, '/ai?tab=business')
    expect(await screen.findByRole('textbox', { name: 'Your question' })).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Business insights' })).not.toBeInTheDocument()
  })
})

describe('Ask', () => {
  it('sends the question as typed (Bangla included) and renders the answer, report table, link, tools and usage', async () => {
    const user = userEvent.setup()
    const fetchMock = mockApi({ 'GET /auth/me': ok(aiManager()), 'POST /ai/ask': ok(askAnswer()) })
    renderRoutes(routes, '/ai')

    const box = await screen.findByRole('textbox', { name: 'Your question' })
    await user.type(box, 'গত সপ্তাহে সেরা পণ্য কোনটি?')
    await user.click(screen.getByRole('button', { name: 'Ask' }))

    const answer = await screen.findByTestId('ai-answer')
    expect(askBodies(fetchMock)).toEqual([{ question: 'গত সপ্তাহে সেরা পণ্য কোনটি?' }])
    expect(answer.closest('[aria-live="polite"]')).not.toBeNull()
    expect(within(answer).getByText('Miniket Rice', { selector: 'strong' })).toBeInTheDocument()
    // Raw HTML from the model is shown as text, never executed.
    expect(answer.querySelector('script')).toBeNull()
    expect(within(answer).getByText('<script>alert(1)</script>')).toBeInTheDocument()

    const table = within(answer).getByRole('table', { name: 'Sales by product' })
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Product', 'Quantity', 'Net sales'])
    expect(within(table).queryByRole('button')).not.toBeInTheDocument()
    expect(within(screen.getByTestId('report-totals')).getAllByRole('cell').map((c) => c.textContent)).toEqual(['65', '17,250.00'])
    expect(within(answer).getByRole('link', { name: /Open full report/ })).toHaveAttribute('href', '/reports/sales_by_product?date_from=2026-10-26&date_to=2026-11-01')

    const tools = within(answer).getByTestId('ai-tools-used')
    expect(within(tools).getByText('How this was answered (2 lookups)')).toBeInTheDocument()
    expect(within(tools).getByText('sales_by_product')).toBeInTheDocument()
    // A call the server refused (branch out of scope) is marked, never shown as data.
    expect(within(within(tools).getByText('sales_daily').parentElement as HTMLElement).getByText('Not run')).toBeInTheDocument()
    expect(within(answer).getByText(/Showing the first 2 of 120 rows./)).toBeInTheDocument()
    expect(within(answer).getByTestId('ai-usage')).toHaveTextContent('Used 1,820 input and 240 output tokens')
  })

  it('asks an example question with the chosen branch, and submits on Enter', async () => {
    const user = userEvent.setup()
    const fetchMock = mockApi({ 'GET /auth/me': ok(aiManager()), 'POST /ai/ask': ok({ ...askAnswer(), report: null, tools_used: [] }) })
    renderRoutes(routes, '/ai')

    await user.click(await screen.findByRole('combobox', { name: 'Branch' }))
    await user.click(await screen.findByRole('option', { name: 'North' }))
    await user.click(screen.getByRole('button', { name: 'Which items are low on stock?' }))
    await screen.findByTestId('ai-answer')
    expect(askBodies(fetchMock).at(-1)).toEqual({ question: 'Which items are low on stock?', branch_id: 'b-2' })
    expect(screen.queryByRole('table')).not.toBeInTheDocument()

    const box = screen.getByRole('textbox', { name: 'Your question' })
    await user.clear(box)
    await user.type(box, 'Sales today?{Enter}')
    await waitFor(() => expect(askBodies(fetchMock)).toHaveLength(2))
    expect(askBodies(fetchMock).at(-1)).toEqual({ question: 'Sales today?', branch_id: 'b-2' })
  })

  it('hides the full-report link from users who cannot open reports', async () => {
    const user = userEvent.setup()
    mockApi({ 'GET /auth/me': ok(aiManager({ permissions: ['branches.view', 'ai.ask'] })), 'POST /ai/ask': ok(askAnswer()) })
    renderRoutes(routes, '/ai')
    await user.type(await screen.findByRole('textbox', { name: 'Your question' }), 'Best sellers?')
    await user.click(screen.getByRole('button', { name: 'Ask' }))
    const answer = await screen.findByTestId('ai-answer')
    expect(within(answer).getByRole('table')).toBeInTheDocument()
    expect(within(answer).queryByRole('link', { name: /Open full report/ })).not.toBeInTheDocument()
  })

  it('refuses an empty question without calling the API', async () => {
    const user = userEvent.setup()
    const fetchMock = mockApi({ 'GET /auth/me': ok(aiManager()) })
    renderRoutes(routes, '/ai')
    await user.click(await screen.findByRole('button', { name: 'Ask' }))
    expect(screen.getByText('Type a question first.')).toBeInTheDocument()
    expect(askBodies(fetchMock)).toHaveLength(0)
  })

  it.each([
    [fail(503, 'AI_UNAVAILABLE', 'AI is not available.'), 'ai-error-unavailable', 'The AI assistant is unavailable'],
    [fail(429, 'AI_BUDGET_EXCEEDED', 'Budget exceeded.'), 'ai-error-budget', 'Monthly AI budget used up'],
    [fail(429, 'TOO_MANY_REQUESTS', 'Too Many Attempts.'), 'ai-error-rate', 'Too many questions at once'],
    [fail(422, 'VALIDATION_FAILED', 'Invalid', { question: ['The question may not be greater than 1000 characters.'] }), 'ai-error-validation', 'The question may not be greater than 1000 characters.'],
  ])('explains a failed request (%#)', async (reply, testId, text) => {
    const user = userEvent.setup()
    mockApi({ 'GET /auth/me': ok(aiManager({ permissions: [...aiManager().permissions, 'ai.manage'] })), 'POST /ai/ask': reply })
    renderRoutes(routes, '/ai')
    await user.type(await screen.findByRole('textbox', { name: 'Your question' }), 'Sales?')
    await user.click(screen.getByRole('button', { name: 'Ask' }))
    const alert = await screen.findByTestId(testId)
    expect(alert).toHaveAttribute('role', 'alert')
    expect(alert).toHaveTextContent(text)
    if (testId === 'ai-error-budget') expect(within(alert).getByRole('link', { name: 'Open AI settings' })).toHaveAttribute('href', '/organization#ai-settings')
  })

  it('explains that AI is off instead of offering the question box', async () => {
    mockApi({ 'GET /auth/me': ok(aiManager({ ai_enabled: false })), 'GET /ai/insights': ok(insights({ narrative: null, ai_enabled: false })) })
    renderRoutes(routes, '/ai')
    expect(await screen.findByTestId('ask-unavailable')).toHaveTextContent('turned off for your organization')
    expect(screen.queryByRole('textbox', { name: 'Your question' })).not.toBeInTheDocument()
  })
})

describe('Business insights', () => {
  it('shows the narrative, KPIs, anomalies, margin drops, shortage risk and slow movers; switches period', async () => {
    const user = userEvent.setup()
    const periods: (string | null)[] = []
    mockApi({
      'GET /auth/me': ok(aiManager()),
      'GET /ai/insights': (_init, url) => {
        periods.push(url.searchParams.get('period'))
        return ok(url.searchParams.get('period') === 'monthly' ? insights({ narrative: 'This month is **ahead**.' }) : insights())
      },
    })
    renderRoutes(routes, '/ai?tab=business')

    const narrative = await screen.findByTestId('insights-narrative')
    expect(within(narrative).getByText('26.7% higher').tagName).toBe('STRONG')
    expect(within(narrative).getByText(/Written by AI/)).toBeInTheDocument()
    expect(screen.getByTestId('insight-kpi-net_sales')).toHaveTextContent('BDT 15,200.00')
    expect(screen.getByTestId('insight-kpi-net_sales')).toHaveTextContent('+26.7%')
    expect(screen.getByTestId('insight-kpi-orders')).toHaveTextContent('42')
    expect(within(screen.getByTestId('insights-anomalies')).getByText('Unusually high')).toBeInTheDocument()
    expect(screen.getByTestId('insights-anomalies')).toHaveTextContent('z = 3.1')
    expect(screen.getByTestId('insights-signals')).toHaveTextContent('Gross margin fell 5.50 points')
    expect(screen.getByTestId('insights-signals')).toHaveTextContent('Margin 18.5% (was 24%)')
    expect(screen.getByTestId('insights-signals')).not.toHaveTextContent('Return spike')
    expect(within(screen.getByRole('table', { name: 'Shortage risk' })).getByText('Mango Juice 1L')).toBeInTheDocument()
    const slow = screen.getByRole('table', { name: 'Slow movers' })
    expect(within(slow).getByText('Winter Jacket')).toBeInTheDocument()
    expect(within(slow).getByText('24,000.00')).toBeInTheDocument()
    expect(screen.getByText('Showing 1 of 12 slow movers.')).toBeInTheDocument()
    const movers = screen.getByRole('table', { name: 'Top movers' })
    expect(within(within(movers).getByText('Miniket Rice').closest('tr') as HTMLElement).getByText('+100%')).toBeInTheDocument()
    expect(within(within(movers).getByText('Soybean Oil').closest('tr') as HTMLElement).getByText('−50%')).toBeInTheDocument()
    // Returns rose from zero: no percentage, the previous figure instead.
    expect(screen.getByTestId('insight-kpi-returns')).toHaveTextContent('Previous: BDT 0.00')
    expect(screen.getByTestId('insight-kpi-margin')).toHaveTextContent('18.5%')
    expect(screen.getByRole('link', { name: /Reorder/ })).toHaveAttribute('href', '/purchasing/reorder')

    await user.click(screen.getByRole('button', { name: 'Monthly' }))
    expect(await screen.findByText('ahead')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Monthly' })).toHaveAttribute('aria-pressed', 'true')
    expect(periods).toEqual(['daily', 'monthly'])
  })

  it('still shows the facts with a notice when AI summaries are off', async () => {
    mockApi({ 'GET /auth/me': ok(aiManager({ ai_enabled: false })), 'GET /ai/insights': ok(insights({ narrative: null, ai_enabled: false })) })
    renderRoutes(routes, '/ai?tab=business')
    expect(await screen.findByTestId('ai-off-notice')).toHaveTextContent('AI summaries are turned off')
    expect(screen.queryByTestId('insights-narrative')).not.toBeInTheDocument()
    expect(screen.getByTestId('insight-kpi-net_sales')).toHaveTextContent('BDT 15,200.00')
    expect(screen.getByRole('table', { name: 'Shortage risk' })).toBeInTheDocument()
  })

  it('shows empty states, leaves out shortage risk without purchasing data and explains a missing summary', async () => {
    const facts = { ...insights().facts, anomalies: [], margin_drop: null, slow_movers: { days: 30, count: 0, items: [] }, shortage_risk: null, top_movers: { up: [], down: [] } }
    mockApi({ 'GET /auth/me': ok(aiManager()), 'GET /ai/insights': ok(insights({ facts, narrative: null, narrative_status: 'budget_exceeded' })) })
    renderRoutes(routes, '/ai?tab=business')
    expect(await screen.findByTestId('narrative-missing')).toHaveTextContent('AI budget is used up')
    expect(screen.queryByTestId('ai-off-notice')).not.toBeInTheDocument()
    expect(screen.getByText(/No unusual days/)).toBeInTheDocument()
    expect(screen.getByText('No margin drops or return spikes in this period.')).toBeInTheDocument()
    expect(screen.getByText(/Everything in stock sold at least once in the last 30 days/)).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Shortage risk' })).not.toBeInTheDocument()
    expect(screen.queryByRole('table', { name: 'Top movers' })).not.toBeInTheDocument()
  })
})

describe('Customer insights', () => {
  it('shows RFM segments in order, masked top customers and loyalty suggestions', async () => {
    const user = userEvent.setup()
    mockApi({ 'GET /auth/me': ok(aiManager()), 'GET /ai/insights': ok(insights()), 'GET /ai/customer-insights': ok(customerInsights()) })
    renderRoutes(routes, '/ai?tab=business')
    await user.click(await screen.findByRole('tab', { name: 'Customers' }))

    const champions = await screen.findByTestId('segment-champions')
    expect(champions).toHaveTextContent('12')
    expect(champions).toHaveTextContent('Spent BDT 250,000.00')
    const order = screen.getAllByTestId(/^segment-/).map((el) => el.dataset.testid)
    expect(order).toEqual(['segment-champions', 'segment-loyal', 'segment-potential', 'segment-new', 'segment-at_risk', 'segment-hibernating'])

    const table = screen.getByRole('table', { name: 'Top customers by segment' })
    const ayesha = within(table).getByText('Ayesha Rahman').closest('tr') as HTMLElement
    expect(within(ayesha).getByText('•••789')).toBeInTheDocument()
    expect(within(ayesha).getByText('Champions')).toBeInTheDocument()
    expect(table).not.toHaveTextContent(/\d{6,}/)
    expect(screen.getByText(/93 customers who bought/)).toBeInTheDocument()
    expect(screen.getByTestId('loyalty-suggestions')).toHaveTextContent('Remind 4 at-risk customers')
    expect(screen.getByTestId('loyalty-suggestions')).toHaveTextContent('At risk · 4 customers')
    expect(screen.queryByTestId('ai-off-notice')).not.toBeInTheDocument()
  })

  it('hides names the server leaves out (no customers.view)', async () => {
    const data = customerInsights()
    const segments = data.segments.map((s) => ({ ...s, top_customers: s.top_customers.map((c) => ({ ...c, name: null, customer_id: null })) }))
    mockApi({ 'GET /auth/me': ok(aiManager()), 'GET /ai/customer-insights': ok({ ...data, segments }) })
    renderRoutes(routes, '/ai?tab=customers')
    const table = await screen.findByRole('table', { name: 'Top customers by segment' })
    expect(within(table).getAllByText('Name hidden')).toHaveLength(2)
    expect(within(table).queryByText('Ayesha Rahman')).not.toBeInTheDocument()
  })

  it('notes that AI summaries are off while showing the segments', async () => {
    mockApi({ 'GET /auth/me': ok(aiManager({ ai_enabled: false })), 'GET /ai/customer-insights': ok(customerInsights({ ai_enabled: false })) })
    renderRoutes(routes, '/ai?tab=customers')
    expect(await screen.findByTestId('ai-off-notice')).toBeInTheDocument()
    expect(screen.getByTestId('segment-at_risk')).toHaveTextContent('7')
  })
})
