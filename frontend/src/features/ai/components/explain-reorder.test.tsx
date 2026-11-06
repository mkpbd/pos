import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { routes } from '@/app/routes'
import { useSessionStore } from '@/stores/session-store'
import { branchesWithStores, makeCurrentUser } from '@/test/fixtures'
import { fail, mockApi, ok, renderRoutes } from '@/test/utils'

beforeEach(() => useSessionStore.setState({ activeBranchId: 'b-1' }))

const paged = (items: unknown[]) => ok(items, { pagination: { current_page: 1, per_page: 25, total: items.length, last_page: 1 } })

const juice = {
  variant: { id: 'v-1', sku: 'JUICE-1L', product_name: 'Mango Juice 1L', variant_name: null, unit: 'pcs', allow_decimal: false },
  on_hand: '4.000', on_order: '0.000', in_transit: '0.000', avg_daily: '2.500', reorder_point: '10.000', target: '45.000',
  suggested_purchase: '48.000', suggested_transfer: '0.000', supplier: null, unit_cost: null, lead_time_days: 3, reason: 'velocity', days_of_cover: '1.6',
}

const user = (permissions: string[], aiEnabled = true) => makeCurrentUser({ permissions: ['branches.view', 'purchases.view', 'suppliers.view', ...permissions], ai_enabled: aiEnabled })

function baseApi(me: ReturnType<typeof user>, explain?: Parameters<typeof mockApi>[0][string]) {
  return mockApi({
    'GET /auth/me': ok(me),
    'GET /branches': paged(branchesWithStores()),
    'GET /suppliers': paged([]),
    'GET /purchasing/reorder-suggestions': paged([juice]),
    ...(explain ? { 'POST /ai/explain-reorder': explain } : {}),
  })
}

describe('Reorder: Explain with AI', () => {
  it('opens a side panel with the explanation for the selected store', async () => {
    const u = userEvent.setup()
    const fetchMock = baseApi(user(['ai.ask']), ok({ narrative: '1. **Mango Juice 1L** first: 1.6 days of cover, 3-day lead time.\n\n<img src=x onerror=alert(1)>', usage: { input_tokens: 900, output_tokens: 120 } }))
    renderRoutes(routes, '/purchasing/reorder')

    await screen.findByText('Mango Juice 1L')
    await u.click(screen.getByRole('button', { name: 'Explain with AI' }))

    const panel = await screen.findByRole('dialog', { name: 'Reorder priorities' })
    const explanation = await within(panel).findByTestId('reorder-explanation')
    expect(within(explanation).getByText('Mango Juice 1L', { selector: 'strong' })).toBeInTheDocument()
    expect(explanation.querySelector('img')).toBeNull()
    expect(explanation).toHaveTextContent('Used 900 input and 120 output tokens.')
    const calls = fetchMock.mock.calls.filter(([url, init]) => String(url).startsWith('/api/v1/ai/explain-reorder') && init?.method === 'POST')
    expect(calls.map(([, init]) => JSON.parse(String(init?.body)))).toEqual([{ store_id: 's-1' }])
  })

  it('shows the budget error in the panel', async () => {
    const u = userEvent.setup()
    baseApi(user(['ai.ask']), fail(429, 'AI_BUDGET_EXCEEDED'))
    renderRoutes(routes, '/purchasing/reorder')
    await screen.findByText('Mango Juice 1L')
    await u.click(screen.getByRole('button', { name: 'Explain with AI' }))
    const panel = await screen.findByRole('dialog', { name: 'Reorder priorities' })
    expect(await within(panel).findByTestId('ai-error-budget')).toBeInTheDocument()
  })

  it('is not offered without ai.ask or when AI is off', async () => {
    baseApi(user([]))
    const { unmount } = renderRoutes(routes, '/purchasing/reorder')
    await screen.findByText('Mango Juice 1L')
    expect(screen.queryByRole('button', { name: 'Explain with AI' })).not.toBeInTheDocument()
    unmount()

    baseApi(user(['ai.ask'], false))
    renderRoutes(routes, '/purchasing/reorder')
    await screen.findByText('Mango Juice 1L')
    expect(screen.queryByRole('button', { name: 'Explain with AI' })).not.toBeInTheDocument()
  })
})
