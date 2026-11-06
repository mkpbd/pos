import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { routes } from '@/app/routes'
import { useSessionStore } from '@/stores/session-store'
import { ADMIN_PERMISSIONS, makeCurrentUser } from '@/test/fixtures'
import { fail, mockApi, ok, renderRoutes } from '@/test/utils'

beforeEach(() => useSessionStore.setState({ activeBranchId: 'b-1' }))

const organization = {
  id: 'o-1', name: 'Corner Shop', slug: 'corner-shop', legal_name: null, tax_number: null, email: null, phone: null, address: null,
  base_currency: 'BDT', timezone: 'Asia/Dhaka', tax_mode: 'exclusive', status: 'active', settings: {},
}
const settings = {
  enabled: false, app_enabled: true, provider_configured: true, effective_enabled: false, provider: 'anthropic', model: 'claude-sonnet',
  monthly_token_budget: null, default_monthly_token_budget: 2000000, effective_monthly_token_budget: 2000000, data_sharing_level: 'aggregates',
  data_sharing_levels: [{ value: 'aggregates', label: 'Aggregates only', description: 'Totals only.' }], updated_at: null,
}
const usage = {
  month: '2026-11', budget: 2000000, budget_source: 'default', unlimited: false, used_tokens: 500000, input_tokens: 400000, output_tokens: 100000,
  remaining_tokens: 1500000, used_pct: '25.0', requests: 14, failed_requests: 1,
  by_feature: [
    { feature: 'ask', requests: 10, failed: 1, input_tokens: 340000, output_tokens: 80000, tokens: 420000 },
    { feature: 'explain_reorder', requests: 4, failed: 0, input_tokens: 60000, output_tokens: 20000, tokens: 80000 },
  ],
}

describe('AI settings card', () => {
  it('shows usage this month and saves the switch and budget', async () => {
    const user = userEvent.setup()
    const patches: unknown[] = []
    mockApi({
      'GET /auth/me': ok(makeCurrentUser({ permissions: [...ADMIN_PERMISSIONS, 'ai.manage'] })),
      'GET /organization': ok(organization),
      'GET /ai/settings': ok(settings),
      'GET /ai/usage': ok(usage),
      'PATCH /ai/settings': (init) => {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>
        patches.push(body)
        return ok({ ...settings, ...body })
      },
    })
    renderRoutes(routes, '/organization')

    const card = (await screen.findByRole('heading', { name: 'AI assistant' })).closest('#ai-settings') as HTMLElement
    expect(await within(card).findByTestId('ai-usage-tokens')).toHaveTextContent('500,000')
    expect(within(card).getByText('2,000,000')).toBeInTheDocument()
    expect(within(card).getByRole('progressbar', { name: 'Monthly token budget used' })).toHaveAttribute('aria-valuenow', '25')
    const byFeature = within(card).getByRole('table', { name: 'AI usage by feature' })
    expect(within(byFeature).getByText('Ask AI')).toBeInTheDocument()
    expect(within(byFeature).getByText('Reorder explanations')).toBeInTheDocument()
    expect(within(card).getByPlaceholderText('Default: 2,000,000')).toBeInTheDocument()

    const save = within(card).getByRole('button', { name: 'Save AI settings' })
    expect(save).toBeDisabled()
    await user.click(within(card).getByRole('switch', { name: 'Enable AI for this organization' }))
    const budget = within(card).getByRole('textbox', { name: 'Monthly token budget' })
    await user.type(budget, '12x')
    await user.click(save)
    expect(within(card).getByText(/Enter a whole number of tokens/)).toBeInTheDocument()
    expect(patches).toHaveLength(0)

    await user.clear(budget)
    await user.type(budget, '500000')
    await user.click(save)
    await waitFor(() => expect(patches).toEqual([{ enabled: true, monthly_token_budget: 500000 }]))
  })

  it('warns when AI is not configured for the installation and shows server validation errors', async () => {
    const user = userEvent.setup()
    mockApi({
      'GET /auth/me': ok(makeCurrentUser({ permissions: [...ADMIN_PERMISSIONS, 'ai.manage'] })),
      'GET /organization': ok(organization),
      'GET /ai/settings': ok({ ...settings, enabled: true, provider_configured: false }),
      'GET /ai/usage': ok({ ...usage, by_feature: [], used_tokens: 0, input_tokens: 0, output_tokens: 0, requests: 0, budget: 0, unlimited: true }),
      'PATCH /ai/settings': fail(422, 'VALIDATION_FAILED', 'Invalid', { monthly_token_budget: ['The budget is too large.'] }),
    })
    renderRoutes(routes, '/organization')
    expect(await screen.findByText(/AI is switched off for this installation/)).toBeInTheDocument()
    expect(await screen.findByText('No AI requests this month.')).toBeInTheDocument()
    expect(screen.getByText('No limit')).toBeInTheDocument()
    await user.type(screen.getByRole('textbox', { name: 'Monthly token budget' }), '999')
    await user.click(screen.getByRole('button', { name: 'Save AI settings' }))
    expect(await screen.findByText('The budget is too large.')).toBeInTheDocument()
  })

  it('is the whole page for ai.manage without organization.view, and absent without ai.manage', async () => {
    mockApi({ 'GET /auth/me': ok(makeCurrentUser({ permissions: ['branches.view', 'ai.manage'] })), 'GET /ai/settings': ok(settings), 'GET /ai/usage': ok(usage) })
    const { unmount } = renderRoutes(routes, '/organization')
    expect(await screen.findByRole('heading', { name: 'AI assistant' })).toBeInTheDocument()
    expect(screen.queryByText('Business profile')).not.toBeInTheDocument()
    unmount()

    mockApi({ 'GET /auth/me': ok(makeCurrentUser()), 'GET /organization': ok(organization) })
    renderRoutes(routes, '/organization')
    expect(await screen.findByText('Business profile')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'AI assistant' })).not.toBeInTheDocument()
  })
})
