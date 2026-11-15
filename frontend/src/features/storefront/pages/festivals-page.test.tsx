import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { routes } from '@/app/routes'
import type { Festival } from '@/features/storefront/festivals/api'
import { makeCurrentUser } from '@/test/fixtures'
import { fail, mockApi, ok, renderRoutes } from '@/test/utils'

/*
 * B17 Online store → Festivals: the calendar (next date, expected note, status), the setup dialog
 * (prefilled dates, what to make, discount, address) → the drafts → Review & publish through
 * publish-all with the ids the setup returned; tribute days; Bangla; permissions.
 */

const toastSuccess = vi.hoisted(() => vi.fn())
vi.mock('sonner', async (importOriginal) => {
  const original = await importOriginal<typeof import('sonner')>()
  return { ...original, toast: Object.assign(vi.fn(), { ...original.toast, success: toastSuccess, error: vi.fn(), message: vi.fn() }) }
})
beforeEach(() => {
  toastSuccess.mockReset()
  window.localStorage.clear()
})

const publisher = () => makeCurrentUser({ permissions: ['storefront.view', 'storefront.manage', 'storefront.publish', 'promotions.view'] })
const manager = () => makeCurrentUser({ permissions: ['storefront.view', 'storefront.manage'] })
const viewer = () => makeCurrentUser({ permissions: ['storefront.view'] })

const eid: Festival = {
  key: 'eid-ul-fitr',
  name: 'Eid-ul-Fitr',
  name_bn: 'ঈদুল ফিতর',
  kind: 'lunar',
  sale_wording: true,
  next: { year: 2028, starts_on: '2028-02-27', ends_on: '2028-02-29', expected: true, note: 'Depends on the moon sighting.', note_bn: 'চাঁদ দেখার ওপর নির্ভর করে।' },
  suggested: { starts_at: '2028-02-16T18:00:00+00:00', ends_at: '2028-02-29T17:59:00+00:00' },
  setup: null,
}
const ekushey: Festival = {
  key: 'ekushey',
  name: 'Ekushey February',
  name_bn: 'একুশে ফেব্রুয়ারি',
  kind: 'fixed',
  sale_wording: false,
  next: { year: 2028, starts_on: '2028-02-21', ends_on: '2028-02-21', expected: false, note: null, note_bn: null },
  suggested: { starts_at: '2028-02-19T18:00:00+00:00', ends_at: '2028-02-21T17:59:00+00:00' },
  setup: null,
}
const docs = [
  { id: 'd-landing', kind: 'page', key: 'landing:victory-day-2027', title: 'Victory Day', role: 'landing', status: 'unpublished', preview_url: 'https://shop.test/p/victory-day-2027?preview=draft' },
  { id: 'd-home', kind: 'page', key: 'home', title: 'Home', role: 'home', status: 'changed', preview_url: 'https://shop.test/?preview=draft' },
] as const
const victory: Festival = {
  key: 'victory-day',
  name: 'Victory Day',
  name_bn: 'বিজয় দিবস',
  kind: 'fixed',
  sale_wording: true,
  next: { year: 2027, starts_on: '2027-12-16', ends_on: '2027-12-16', expected: false, note: null, note_bn: null },
  suggested: { starts_at: '2027-12-09T18:00:00+00:00', ends_at: '2027-12-16T17:59:00+00:00' },
  setup: { year: 2027, starts_at: '2027-12-10T00:00:00+06:00', ends_at: '2027-12-16T23:59:00+06:00', state: 'drafts_ready', landing_slug: 'victory-day-2027', documents: [...docs] },
}

const promotions = ok(
  [
    { id: 'p-eid', name: 'Eid 15%', type: 'percent', value: '15', scope: 'order', trigger: 'coupon', starts_at: null, ends_at: null, is_active: true, state: 'active', coupon_count: 1, redemption_count: 0, discount_total: '0' },
    { id: 'p-old', name: 'Old sale', type: 'fixed', value: '50', scope: 'order', trigger: 'auto', starts_at: null, ends_at: null, is_active: false, state: 'expired', coupon_count: 0, redemption_count: 0, discount_total: '0' },
  ],
  { pagination: { current_page: 1, per_page: 100, total: 2, last_page: 1 } },
)

describe('FestivalsPage', () => {
  it('lists the festivals with dates, the expected note, status and the tribute day', async () => {
    mockApi({ 'GET /auth/me': ok(publisher()), 'GET /storefront/festivals': ok([victory, ekushey, eid]) })
    renderRoutes(routes, '/storefront/festivals')
    const list = await screen.findByRole('list', { name: 'Festivals and special days in the next 12 months' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(3)
    expect(screen.getByRole('link', { name: 'Festivals' })).toHaveAttribute('aria-current', 'page')

    const eidRow = within(screen.getByTestId('festival-eid-ul-fitr'))
    expect(eidRow.getByRole('heading', { name: /Eid-ul-Fitr/ })).toBeInTheDocument()
    expect(eidRow.getByText('ঈদুল ফিতর')).toHaveAttribute('lang', 'bn')
    expect(eidRow.getByTestId('festival-expected')).toHaveTextContent('Expected date')
    expect(eidRow.getByText(/Depends on the moon sighting/)).toBeInTheDocument()
    expect(eidRow.getByTestId('festival-status')).toHaveTextContent('Not set up')
    expect(eidRow.getByText(/27 February 2028 – .*29 February 2028/)).toBeInTheDocument()

    const victoryRow = within(screen.getByTestId('festival-victory-day'))
    expect(victoryRow.getByTestId('festival-status')).toHaveTextContent('Drafts ready')
    expect(victoryRow.getByTestId('festival-window')).toHaveTextContent(/Shows 10 December 2027/)
    expect(victoryRow.getByRole('button', { name: 'Review and publish Victory Day' })).toBeInTheDocument()

    expect(within(screen.getByTestId('festival-ekushey')).getByText(/respectful tribute/)).toBeInTheDocument()
  })

  it('sets a festival up, then publishes the drafts it made with publish-all', async () => {
    const user = userEvent.setup()
    let setupBody: Record<string, unknown> | null = null
    let publishBody: Record<string, unknown> | null = null
    mockApi({
      'GET /auth/me': ok(publisher()),
      'GET /storefront/festivals': ok([eid]),
      'GET /promotions': promotions,
      'POST /storefront/festivals/eid-ul-fitr/setup': (init) => {
        setupBody = JSON.parse(String(init.body))
        return ok({
          festival: eid,
          documents: [
            { id: 'd-l', kind: 'page', key: 'landing:eid-2028', title: 'Eid Mubarak', role: 'landing', status: 'unpublished', preview_url: 'https://shop.test/p/eid-2028?preview=draft' },
            { id: 'd-h', kind: 'page', key: 'home', title: 'Home', role: 'home', status: 'changed', preview_url: null },
          ],
          publish_ids: ['d-l', 'd-h'],
        })
      },
      'POST /storefront/builder/publish-all': (init) => {
        publishBody = JSON.parse(String(init.body))
        return ok({ published: 2 })
      },
    })
    renderRoutes(routes, '/storefront/festivals')
    await user.click(await screen.findByRole('button', { name: 'Set up Eid-ul-Fitr' }))
    const dialog = await screen.findByRole('dialog', { name: 'Set up Eid-ul-Fitr' })
    expect(within(dialog).getByLabelText('Starts')).toHaveValue('2028-02-17T00:00')
    expect(within(dialog).getByLabelText('Ends')).toHaveValue('2028-02-29T23:59')
    expect(within(dialog).getByText(/Asia\/Dhaka/)).toBeInTheDocument()

    await user.click(within(dialog).getByRole('checkbox', { name: 'An announcement bar' }))
    const slug = within(dialog).getByLabelText('Address of the festival page')
    await user.clear(slug)
    await user.type(slug, 'eid-2028')
    expect(within(dialog).getByText('/p/eid-2028')).toBeInTheDocument()
    const discount = within(dialog).getByLabelText('Discount')
    await waitFor(() => expect(within(discount).getByRole('option', { name: /Eid 15%/ })).toBeInTheDocument())
    expect(within(discount).queryByRole('option', { name: /Old sale/ })).toBeNull()
    await user.selectOptions(discount, 'p-eid')
    await user.click(within(dialog).getByRole('button', { name: 'Make the drafts' }))

    const review = await screen.findByRole('dialog', { name: /Eid-ul-Fitr: drafts ready/ })
    expect(setupBody).toEqual({
      year: 2028,
      starts_at: '2028-02-17T00:00:00+06:00',
      ends_at: '2028-02-29T23:59:00+06:00',
      include: { landing: true, home_hero: true, bar: false },
      discount_id: 'p-eid',
      landing_slug: 'eid-2028',
    })
    const landing = within(within(review).getByTestId('festival-doc-landing'))
    expect(landing.getByText('Festival page')).toBeInTheDocument()
    expect(landing.getByRole('link', { name: 'Edit Eid Mubarak' })).toHaveAttribute('href', '/storefront/builder/d-l')
    expect(landing.getByRole('link', { name: /Preview Eid Mubarak/ })).toHaveAttribute('href', 'https://shop.test/p/eid-2028?preview=draft')
    expect(within(within(review).getByTestId('festival-doc-home')).getByText('Changes not published')).toBeInTheDocument()

    await user.click(within(review).getByRole('button', { name: 'Publish all' }))
    const confirm = await screen.findByRole('alertdialog')
    expect(within(confirm).getByText(/other changes in its draft are published too/)).toBeInTheDocument()
    await user.click(within(confirm).getByRole('button', { name: 'Publish all' }))
    expect(await screen.findByRole('dialog', { name: /Eid-ul-Fitr is ready/ })).toBeInTheDocument()
    expect(publishBody).toEqual({ documents: ['d-l', 'd-h'], theme: false, note: 'Eid-ul-Fitr 2028' })
    expect(toastSuccess).toHaveBeenCalledWith('Published. It shows and hides by itself on the dates.')
  })

  it('checks the form and shows the server’s address and date problems', async () => {
    const user = userEvent.setup()
    mockApi({
      'GET /auth/me': ok(publisher()),
      'GET /storefront/festivals': ok([eid]),
      'GET /promotions': promotions,
      'POST /storefront/festivals/eid-ul-fitr/setup': fail(422, 'SLUG_TAKEN', 'Taken'),
    })
    renderRoutes(routes, '/storefront/festivals')
    await user.click(await screen.findByRole('button', { name: 'Set up Eid-ul-Fitr' }))
    const dialog = await screen.findByRole('dialog', { name: 'Set up Eid-ul-Fitr' })
    for (const name of ['A festival page', 'A banner at the top of your home page', 'An announcement bar']) await user.click(within(dialog).getByRole('checkbox', { name }))
    await user.clear(within(dialog).getByLabelText('Ends'))
    await user.type(within(dialog).getByLabelText('Ends'), '2028-05-30T10:00')
    await user.click(within(dialog).getByRole('button', { name: 'Make the drafts' }))
    expect(within(dialog).getByText('Choose at least one thing to make.')).toBeInTheDocument()
    expect(within(dialog).getByText('At most 60 days, please.')).toBeInTheDocument()

    await user.click(within(dialog).getByRole('checkbox', { name: 'A festival page' }))
    await user.clear(within(dialog).getByLabelText('Ends'))
    await user.type(within(dialog).getByLabelText('Ends'), '2028-02-29T23:59')
    await user.click(within(dialog).getByRole('button', { name: 'Make the drafts' }))
    expect(await within(dialog).findByText(/Another page already uses this address/)).toBeInTheDocument()
  })

  it('a tribute day hides the discount unless the owner asks for one', async () => {
    const user = userEvent.setup()
    mockApi({ 'GET /auth/me': ok(publisher()), 'GET /storefront/festivals': ok([ekushey]), 'GET /promotions': promotions })
    renderRoutes(routes, '/storefront/festivals')
    await user.click(await screen.findByRole('button', { name: 'Set up Ekushey February' }))
    const dialog = await screen.findByRole('dialog', { name: 'Set up Ekushey February' })
    expect(within(dialog).getByTestId('festival-tribute')).toHaveTextContent(/no sale words/)
    expect(within(dialog).queryByLabelText('Discount')).toBeNull()
    await user.click(within(dialog).getByRole('checkbox', { name: 'Add a discount anyway' }))
    expect(within(dialog).getByLabelText('Discount')).toBeInTheDocument()
  })

  it('opens the review of drafts ready from the list; a manager without publish can’t publish', async () => {
    const user = userEvent.setup()
    mockApi({ 'GET /auth/me': ok(manager()), 'GET /storefront/festivals': ok([victory]) })
    renderRoutes(routes, '/storefront/festivals')
    await user.click(await screen.findByRole('button', { name: 'Review and publish Victory Day' }))
    const review = await screen.findByRole('dialog', { name: /Victory Day: drafts ready/ })
    expect(within(review).getAllByRole('listitem')).toHaveLength(2)
    expect(within(review).getByRole('button', { name: 'Publish all' })).toBeDisabled()
    expect(within(review).getByText(/allowed to publish/)).toBeInTheDocument()
  })

  it('switches to Bangla; viewers see the calendar without setup buttons', async () => {
    const user = userEvent.setup()
    mockApi({ 'GET /auth/me': ok(viewer()), 'GET /storefront/festivals': ok([eid]) })
    renderRoutes(routes, '/storefront/festivals')
    expect(await screen.findByText(/setting up a festival needs permission/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Set up/ })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'বাংলা' }))
    expect(screen.getByRole('heading', { name: /উৎসব/ })).toBeInTheDocument()
    expect(within(screen.getByTestId('festival-eid-ul-fitr')).getByTestId('festival-status')).toHaveTextContent('সেট আপ করা হয়নি')
    expect(within(screen.getByTestId('festival-eid-ul-fitr')).getByText(/চাঁদ দেখার ওপর নির্ভর করে/)).toBeInTheDocument()
    expect(window.localStorage.getItem('pos.storeBuilder.pagesLang')).toBe('bn')
  })
})
