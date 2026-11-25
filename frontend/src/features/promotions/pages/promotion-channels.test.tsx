import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { routes } from '@/app/routes'
import { promotion, promotionManager, promotionRow, promotionViewer, redemption } from '@/features/promotions/test-data'
import { makeCurrentUser } from '@/test/fixtures'
import { mockApi, ok, renderRoutes } from '@/test/utils'

const paged = (items: unknown[]) => ok(items, { pagination: { current_page: 1, per_page: 25, total: items.length, last_page: 1 } })

describe('where a promotion applies (POS1a)', () => {
  it('badges each row with its channels; rows from older servers count as online', async () => {
    mockApi({
      'GET /auth/me': ok(promotionManager()),
      'GET /promotions': paged([
        promotionRow({ channels: ['online', 'till'] }),
        promotionRow({ id: 'pr-2', name: 'Counter deal', channels: ['till'] }),
        promotionRow({ id: 'pr-3', name: 'Web only', channels: undefined }),
      ]),
    })
    renderRoutes(routes, '/promotions')

    await screen.findByRole('link', { name: 'Juice week' })
    const channels = screen.getAllByTestId('promotion-channels')
    expect(channels.map((c) => c.textContent)).toEqual(['Online storeTill', 'Till', 'Online store'])
  })

  it('sends the chosen channels and needs at least one', async () => {
    const user = userEvent.setup()
    document.cookie = 'XSRF-TOKEN=t'
    let body: Record<string, unknown> | undefined
    mockApi({
      'GET /auth/me': ok(promotionManager()),
      'GET /promotions/pr-1': ok(promotion({ channels: ['online'] })),
      'GET /promotions/pr-1/redemptions': paged([]),
      'PATCH /promotions/pr-1': (init) => {
        body = JSON.parse(String(init.body))
        return ok(promotion({ channels: ['till'] }))
      },
    })
    renderRoutes(routes, '/promotions/pr-1')

    const online = await screen.findByRole('checkbox', { name: 'Online store' })
    const till = screen.getByRole('checkbox', { name: 'Till' })
    expect(online).toBeChecked()
    expect(till).not.toBeChecked()

    await user.click(online)
    await user.click(screen.getByRole('button', { name: 'Save promotion' }))
    expect(await screen.findByText('Choose at least one: the online store or the till.')).toBeInTheDocument()
    expect(body).toBeUndefined()

    await user.click(till)
    await user.click(screen.getByRole('button', { name: 'Save promotion' }))
    await waitFor(() => expect(body).toBeDefined())
    expect(body?.channels).toEqual(['till'])
  })

  it('keeps free shipping to the online store', async () => {
    const user = userEvent.setup()
    mockApi({ 'GET /auth/me': ok(promotionManager()) })
    renderRoutes(routes, '/promotions/new')

    await user.click(await screen.findByRole('checkbox', { name: 'Till' }))
    expect(screen.getByRole('checkbox', { name: 'Till' })).toBeChecked()
    await user.click(screen.getByRole('combobox', { name: 'Discount type' }))
    await user.click(await screen.findByRole('option', { name: 'Free shipping' }))
    expect(screen.getByRole('checkbox', { name: 'Till' })).toBeDisabled()
    expect(screen.getByRole('checkbox', { name: 'Till' })).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Online store' })).toBeChecked()
  })

  it('is read-only without promotions.manage', async () => {
    mockApi({
      'GET /auth/me': ok(promotionViewer()),
      'GET /promotions/pr-1': ok(promotion({ channels: ['online', 'till'] })),
      'GET /promotions/pr-1/redemptions': paged([]),
    })
    renderRoutes(routes, '/promotions/pr-1')

    expect(await screen.findByRole('checkbox', { name: 'Till' })).toBeDisabled()
    expect(screen.getByRole('checkbox', { name: 'Till' })).toBeChecked()
  })

  it('lists till sales among the redemptions', async () => {
    const user = userEvent.setup()
    mockApi({
      'GET /auth/me': ok(makeCurrentUser({ permissions: ['promotions.view', 'sales.view'] })),
      'GET /promotions/pr-1': ok(promotion({ channels: ['till'] })),
      'GET /promotions/pr-1/redemptions': paged([redemption({ order_id: null, order_number: 'INV-000042', sale_id: 's-1', email: null, coupon_code: null })]),
    })
    renderRoutes(routes, '/promotions/pr-1')

    await user.click(await screen.findByRole('tab', { name: /Redemptions/ }))
    const table = await screen.findByRole('table', { name: 'Redemptions' })
    expect(within(table).getByRole('link', { name: 'INV-000042' })).toHaveAttribute('href', '/sales/s-1')
  })
})
