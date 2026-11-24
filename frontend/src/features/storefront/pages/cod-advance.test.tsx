import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { routes } from '@/app/routes'
import type { StorefrontSettings } from '@/features/storefront/api'
import { codAdvanceChanges, toCodAdvanceDraft, validateCodAdvance } from '@/features/storefront/cod-advance'
import { makeCurrentUser } from '@/test/fixtures'
import { fail, mockApi, ok, renderRoutes } from '@/test/utils'

const settings = (overrides: Partial<StorefrontSettings> = {}): StorefrontSettings => ({
  is_enabled: true,
  site_name: 'Berry Kids',
  meta_description: null,
  fulfilment_store_id: null,
  cod_review: 'off',
  cod_review_min_success_rate: 70,
  cod_review_new_numbers: false,
  cod_advance: 'off',
  cod_advance_amount: 'delivery',
  cod_advance_fixed: null,
  cod_advance_hold_hours: 24,
  cod_advance_ready: true,
  updated_at: null,
  ...overrides,
})
const storeManager = (extra: string[] = []) => makeCurrentUser({ permissions: ['storefront.view', 'storefront.manage', ...extra] })
const branches = ok([], { pagination: { current_page: 1, per_page: 100, total: 0, last_page: 1 } })

describe('BD1c storefront settings: advance delivery charge', () => {
  it('asks risky orders for a fixed advance and saves only the changes', async () => {
    const user = userEvent.setup()
    const patches: Record<string, unknown>[] = []
    let current = settings()
    mockApi({
      'GET /auth/me': ok(storeManager()),
      'GET /storefront/settings': () => ok(current),
      'GET /storefront/domains': ok([]),
      'GET /branches': branches,
      'PATCH /storefront/settings': (init) => {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>
        patches.push(body)
        if (body.cod_advance_hold_hours === 100) return fail(422, 'VALIDATION_FAILED', 'Invalid', { cod_advance_hold_hours: ['Too long for this shop.'] })
        current = { ...current, ...body }
        return ok(current)
      },
    })
    renderRoutes(routes, '/storefront')

    const card = await screen.findByTestId('cod-advance-card')
    expect(within(card).getByText('Advance delivery charge for cash on delivery')).toBeInTheDocument()
    expect(within(card).queryByTestId('cod-advance-not-ready')).not.toBeInTheDocument()
    expect(within(card).getByRole('radio', { name: 'Off' })).toBeChecked()
    expect(within(card).queryByRole('radio', { name: 'A fixed amount' })).not.toBeInTheDocument()
    expect(within(card).getByRole('button', { name: 'Save advance settings' })).toBeDisabled()

    await user.click(within(card).getByRole('radio', { name: 'Only risky orders' }))
    expect(card).toHaveTextContent('Uses the cash on delivery check rules')
    await user.click(within(card).getByRole('radio', { name: 'A fixed amount' }))
    const fixed = within(card).getByLabelText('Fixed advance (BDT)')
    await user.type(fixed, '0')
    await user.click(within(card).getByRole('button', { name: 'Save advance settings' }))
    expect(fixed).toHaveAccessibleDescription('An amount above 0 with at most 2 decimals.')
    expect(patches).toHaveLength(0)

    await user.clear(fixed)
    await user.type(fixed, '150')
    const hours = within(card).getByLabelText('Hours to pay')
    await user.clear(hours)
    await user.type(hours, '100')
    await user.click(within(card).getByRole('button', { name: 'Save advance settings' }))
    await waitFor(() => expect(hours).toHaveAccessibleDescription('Too long for this shop.'))

    await user.clear(hours)
    await user.type(hours, '12')
    await user.click(within(card).getByRole('button', { name: 'Save advance settings' }))
    await waitFor(() => expect(patches.at(-1)).toEqual({ cod_advance: 'risky', cod_advance_hold_hours: 12, cod_advance_amount: 'fixed', cod_advance_fixed: '150' }))
    await waitFor(() => expect(within(card).getByRole('button', { name: 'Save advance settings' })).toBeDisabled())
  })

  it('warns when no Send Money method is on', async () => {
    mockApi({
      'GET /auth/me': ok(storeManager(['payment_gateways.manage'])),
      'GET /storefront/settings': ok(settings({ cod_advance: 'all', cod_advance_ready: false })),
      'GET /storefront/domains': ok([]),
      'GET /branches': branches,
    })
    renderRoutes(routes, '/storefront')
    const card = await screen.findByTestId('cod-advance-card')
    const note = within(card).getByTestId('cod-advance-not-ready')
    expect(note).toHaveTextContent('Turn on bKash, Nagad or Rocket Send Money first')
    expect(within(note).getByRole('link', { name: 'Payment methods' })).toHaveAttribute('href', '/storefront/payments')
    expect(within(card).getByRole('radio', { name: 'All orders' })).toBeChecked()
  })

  it('is read-only without storefront.manage', async () => {
    mockApi({
      'GET /auth/me': ok(makeCurrentUser({ permissions: ['storefront.view'] })),
      'GET /storefront/settings': ok(settings({ cod_advance: 'all' })),
      'GET /storefront/domains': ok([]),
      'GET /branches': branches,
    })
    renderRoutes(routes, '/storefront')
    const card = await screen.findByTestId('cod-advance-card')
    expect(within(card).getByRole('radio', { name: 'All orders' })).toBeDisabled()
    expect(within(card).queryByRole('button', { name: 'Save advance settings' })).not.toBeInTheDocument()
  })

  it('validates and diffs the draft', () => {
    const s = settings({ cod_advance: 'all', cod_advance_amount: 'fixed', cod_advance_fixed: '100.00' })
    const draft = toCodAdvanceDraft(s)
    expect(codAdvanceChanges(draft, s)).toEqual({})
    expect(codAdvanceChanges({ ...draft, amount: 'delivery' }, s)).toEqual({ cod_advance_amount: 'delivery', cod_advance_fixed: null })
    // Turning it off keeps the saved amount choice.
    expect(codAdvanceChanges({ ...draft, mode: 'off', amount: 'delivery' }, s)).toEqual({ cod_advance: 'off' })
    expect(validateCodAdvance({ ...draft, fixed: '12.345' })).toEqual({ fixed: 'An amount above 0 with at most 2 decimals.' })
    expect(validateCodAdvance({ ...draft, hours: '0' })).toEqual({ hours: 'Whole hours between 1 and 168.' })
    expect(validateCodAdvance({ ...draft, mode: 'off', fixed: '' })).toEqual({})
  })
})
