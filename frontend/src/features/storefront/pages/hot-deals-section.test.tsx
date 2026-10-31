import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { routes } from '@/app/routes'
import { promotionRow } from '@/features/promotions/test-data'
import type { HomepageSection, SectionTypeInfo } from '@/features/storefront/api'
import { makeCurrentUser } from '@/test/fixtures'
import { mockApi, ok, renderRoutes } from '@/test/utils'

vi.mock('sonner', async (importOriginal) => {
  const original = await importOriginal<typeof import('sonner')>()
  return { ...original, toast: Object.assign(vi.fn(), { ...original.toast, error: vi.fn(), success: vi.fn() }) }
})

const manager = (extra: string[] = ['promotions.view']) => makeCurrentUser({ permissions: ['storefront.view', 'storefront.manage', ...extra] })
const hotDealsType: SectionTypeInfo = {
  type: 'hot_deals', label: 'Hot deals', description: 'Flash-sale products with a countdown.', banner_placement: null, items: null,
  defaults: { promotion_id: null, limit: 8, view_all_url: null },
}
const section = (overrides: Partial<HomepageSection> = {}): HomepageSection => ({
  id: 's-9', type: 'hot_deals', type_label: 'Hot deals', title: 'Hot deals', subtitle: null, config: { promotion_id: null, limit: 8, view_all_url: null },
  banner_ids: [], is_enabled: true, starts_at: null, ends_at: null, state: 'live', sort_order: 0, updated_at: null, ...overrides,
})
const paged = (items: unknown[]) => ok(items, { pagination: { current_page: 1, per_page: 100, total: items.length, last_page: 1 } })
const active = [
  promotionRow(),
  promotionRow({ id: 'pr-5', name: 'Weekend coupon', trigger: 'coupon', show_countdown: false }),
  promotionRow({ id: 'pr-6', name: 'Biscuit blitz', ends_at: '2026-11-03T18:00:00Z' }),
]

describe('hot deals homepage section', () => {
  it('adds a section for one flash sale; only countdown promotions are offered', async () => {
    const user = userEvent.setup()
    let created: Record<string, unknown> | undefined
    let promotionsQuery: URLSearchParams | undefined
    mockApi({
      'GET /auth/me': ok(manager()),
      'GET /storefront/homepage-sections/types': ok([hotDealsType]),
      'GET /storefront/homepage-sections': ok([]),
      'GET /promotions': (_init, url) => {
        promotionsQuery = url.searchParams
        return paged(active)
      },
      'POST /storefront/homepage-sections': (init) => {
        created = JSON.parse(String(init.body)) as Record<string, unknown>
        return ok(section())
      },
    })
    renderRoutes(routes, '/storefront/homepage')

    await user.click(await screen.findByRole('button', { name: 'Add section' }))
    await user.click(await screen.findByRole('button', { name: /Hot deals/ }))
    const dialog = await screen.findByRole('dialog')

    await user.click(within(dialog).getByRole('combobox', { name: 'Flash sale' }))
    const options = await screen.findAllByRole('option')
    expect(options.map((o) => o.textContent)).toEqual(['All flash sales', 'Juice week', 'Biscuit blitz'])
    expect(promotionsQuery?.get('status')).toBe('active')
    await user.click(screen.getByRole('option', { name: 'Biscuit blitz' }))

    await user.click(within(dialog).getByRole('combobox', { name: 'Number of products' }))
    await user.click(await screen.findByRole('option', { name: '12' }))
    await user.type(within(dialog).getByLabelText('“View all” link'), 'javascript:x')
    await user.click(within(dialog).getByRole('button', { name: 'Add section' }))
    expect(await within(dialog).findByText('Use a site path such as /shop or an http(s) URL.')).toBeInTheDocument()

    await user.clear(within(dialog).getByLabelText('“View all” link'))
    await user.type(within(dialog).getByLabelText('“View all” link'), ' /shop ')
    await user.click(within(dialog).getByRole('button', { name: 'Add section' }))

    await waitFor(() => expect(created).toBeDefined())
    expect(created).toMatchObject({ type: 'hot_deals', config: { promotion_id: 'pr-6', limit: 12, view_all_url: '/shop' } })
    expect(created).not.toHaveProperty('item_ids')
  })

  it('summarises the chosen flash sale in the section list', async () => {
    mockApi({
      'GET /auth/me': ok(manager()),
      'GET /storefront/homepage-sections/types': ok([hotDealsType]),
      'GET /storefront/homepage-sections': ok([section(), section({ id: 's-10', title: 'Juice deals', config: { promotion_id: 'pr-1', limit: 8, view_all_url: null } })]),
      'GET /promotions': paged(active),
    })
    renderRoutes(routes, '/storefront/homepage')

    expect(await screen.findByText(/All flash sales/)).toBeInTheDocument()
    expect(await screen.findByText(/· Juice week/)).toBeInTheDocument()
  })

  it('still offers “All flash sales” to staff without promotions access', async () => {
    const user = userEvent.setup()
    mockApi({
      'GET /auth/me': ok(manager([])),
      'GET /storefront/homepage-sections/types': ok([hotDealsType]),
      'GET /storefront/homepage-sections': ok([section()]),
    })
    renderRoutes(routes, '/storefront/homepage')

    await user.click(await screen.findByRole('button', { name: 'Edit Hot deals' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/Choosing a single promotion needs access to Promotions/)).toBeInTheDocument()
    expect(within(dialog).getByRole('combobox', { name: 'Flash sale' })).toHaveTextContent('All flash sales')
  })
})
