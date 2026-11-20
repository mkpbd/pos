import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { routes } from '@/app/routes'
import { captureDownloads, mockApiWithExports } from '@/features/exports/testing'
import { fromPathProblem, normalizePath, toPathProblem, type StoreRedirect } from '@/features/storefront/redirects'
import { makeCurrentUser } from '@/test/fixtures'
import { fail, mockApi, ok, renderRoutes } from '@/test/utils'

/*
 * B16 §5: Online store → Redirects — the list (automatic / added by you, hits, last used), search
 * and the source filter, add / edit / delete with checks, "Test an address" and the CSV download.
 */

const toastSuccess = vi.hoisted(() => vi.fn())
const toastError = vi.hoisted(() => vi.fn())
vi.mock('sonner', async (importOriginal) => {
  const original = await importOriginal<typeof import('sonner')>()
  return { ...original, toast: Object.assign(vi.fn(), { ...original.toast, success: toastSuccess, error: toastError, message: vi.fn() }) }
})
beforeEach(() => {
  toastSuccess.mockReset()
  toastError.mockReset()
})

const manager = () => makeCurrentUser({ permissions: ['storefront.view', 'storefront.manage'] })
const viewer = () => makeCurrentUser({ permissions: ['storefront.view', 'online_catalog.view'] })

const AUTO: StoreRedirect = {
  id: 'r-1', from_path: '/product/old-saree', to_path: '/product/red-saree', type: 301, source: 'auto', hits: 1240, last_hit_at: '2026-11-18T10:00:00Z', created_at: '2026-11-01T10:00:00Z', updated_at: null,
}
const MANUAL: StoreRedirect = {
  id: 'r-2', from_path: '/p/eid-2025', to_path: '/p/eid-2026', type: 302, source: 'manual', hits: 0, last_hit_at: null, created_at: '2026-11-02T10:00:00Z', updated_at: null,
}
const page = (items: StoreRedirect[]) => ok(items, { pagination: { current_page: 1, per_page: 25, total: items.length, last_page: 1 } })

describe('redirect paths', () => {
  it('normalizes addresses like the server: full links keep their path, slashes are tidied', () => {
    expect(normalizePath(' p/eid/ ')).toBe('/p/eid')
    expect(normalizePath('https://shop.example.com//p//eid/?utm_source=fb#top')).toBe('/p/eid?utm_source=fb')
    expect(normalizePath('/')).toBe('/')
    expect(normalizePath('')).toBe('')
  })

  it('checks the old and the new address in plain words', () => {
    expect(fromPathProblem('')).toMatch(/Enter the old address/)
    expect(fromPathProblem('/p/eid 2025')).toBe('An address cannot contain spaces.')
    expect(fromPathProblem('/')).toBe('Your home page cannot be sent elsewhere.')
    expect(fromPathProblem('/admin/orders')).toMatch(/belongs to the system/)
    expect(fromPathProblem('/api/v1/store')).toMatch(/belongs to the system/)
    expect(fromPathProblem('/p/eid-2025')).toBeNull()
    expect(toPathProblem('')).toMatch(/Enter where shoppers should go/)
    expect(toPathProblem('p/eid')).toMatch(/Start with “\/”/)
    expect(toPathProblem('//evil.example')).toMatch(/Start with “\/”/)
    expect(toPathProblem('/p/eid/', '/p/eid')).toBe('The new address is the same as the old one.')
    expect(toPathProblem('https://facebook.com/myshop')).toBeNull()
    expect(toPathProblem('/p/eid-2026', '/p/eid-2025')).toBeNull()
  })
})

describe('RedirectsPage', () => {
  it('lists redirects with their source, kind and use, and has its Online store tab for managers only', async () => {
    mockApi({ 'GET /auth/me': ok(manager()), 'GET /storefront/redirects': page([AUTO, MANUAL]) })
    renderRoutes(routes, '/storefront/redirects')
    const table = await screen.findByRole('table', { name: 'Redirects' })
    const auto = within(screen.getByTestId('redirect-r-1'))
    expect(auto.getByText('/product/old-saree')).toBeInTheDocument()
    expect(auto.getByText('/product/red-saree')).toBeInTheDocument()
    // The source as a badge, and under the old address on phones.
    expect(auto.getAllByText('Automatic')).toHaveLength(2)
    expect(auto.getByText('Moved for good (301)')).toBeInTheDocument()
    expect(auto.getByText('1,240')).toBeInTheDocument()
    expect(auto.getByText(/^Last /)).toBeInTheDocument()
    const manual = within(screen.getByTestId('redirect-r-2'))
    expect(manual.getAllByText('Added by you')).toHaveLength(2)
    expect(manual.getByText('Moved for now (302)')).toBeInTheDocument()
    expect(manual.getByText('Not used yet')).toBeInTheDocument()
    expect(within(table).getAllByRole('row')).toHaveLength(3)
    expect(screen.getByRole('link', { name: 'Redirects' })).toHaveAttribute('href', '/storefront/redirects')
  })

  it('has no tab and no page without storefront.manage', async () => {
    mockApi({ 'GET /auth/me': ok(viewer()), 'GET /online-catalog/size-guides': ok([]), 'GET /online-catalog/categories': ok([]) })
    const { router } = renderRoutes(routes, '/storefront/redirects')
    expect(await screen.findByText(/does not include the “storefront.manage” permission/)).toBeInTheDocument()
    await router.navigate('/storefront/size-guides')
    expect(await screen.findByRole('link', { name: 'Size guides' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Redirects' })).toBeNull()
  })

  it('searches and filters by source on the server', async () => {
    const user = userEvent.setup()
    const fetchMock = mockApi({
      'GET /auth/me': ok(manager()),
      'GET /storefront/redirects': (_init, url) => (url.searchParams.get('search') === 'nothing' ? page([]) : page(url.searchParams.get('source') === 'manual' ? [MANUAL] : [AUTO, MANUAL])),
    })
    renderRoutes(routes, '/storefront/redirects')
    await screen.findByTestId('redirect-r-1')
    await user.click(screen.getByRole('combobox', { name: 'Show' }))
    await user.click(await screen.findByRole('option', { name: 'Added by you only' }))
    await waitFor(() => expect(screen.queryByTestId('redirect-r-1')).toBeNull())
    expect(screen.getByTestId('redirect-r-2')).toBeInTheDocument()
    await user.type(screen.getByRole('searchbox', { name: 'Search redirects' }), 'nothing')
    expect(await screen.findByText('No redirects match')).toBeInTheDocument()
    const last = new URL(String(fetchMock.mock.calls.at(-1)?.[0]), 'http://localhost')
    expect(Object.fromEntries(last.searchParams)).toEqual({ page: '1', per_page: '25', search: 'nothing', source: 'manual' })
  })

  it('adds a redirect: checks the addresses first, saves the tidied old address, shows the server’s field errors', async () => {
    const user = userEvent.setup()
    const bodies: Record<string, unknown>[] = []
    mockApi({
      'GET /auth/me': ok(manager()),
      'GET /storefront/redirects': page([]),
      'POST /storefront/redirects': (init) => {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>
        bodies.push(body)
        if (bodies.length === 1) return fail(422, 'VALIDATION_FAILED', 'Invalid', { from_path: ['This address is a live page of your shop.'] })
        return { status: 201, ...ok({ ...MANUAL, id: 'r-9', from_path: body.from_path, to_path: body.to_path, type: body.type }) }
      },
    })
    renderRoutes(routes, '/storefront/redirects')
    expect(await screen.findByText('No redirects yet')).toBeInTheDocument()
    await user.click(screen.getAllByRole('button', { name: 'Add redirect' })[0]!)
    const dialog = await screen.findByRole('dialog', { name: 'Add a redirect' })
    await user.click(within(dialog).getByRole('button', { name: 'Add redirect' }))
    expect(within(dialog).getByText(/Enter the old address/)).toBeInTheDocument()
    expect(within(dialog).getByText(/Enter where shoppers should go/)).toBeInTheDocument()
    expect(bodies).toEqual([])

    await user.type(within(dialog).getByLabelText('Old address'), 'https://shop.example.com/p/eid-2025/')
    expect(within(dialog).getByTestId('redirect-from-preview')).toHaveTextContent('Saved as /p/eid-2025')
    await user.type(within(dialog).getByLabelText('New address'), 'https://facebook.com/eid')
    expect(within(dialog).getByTestId('redirect-external-warning')).toHaveTextContent(/shoppers leave your shop/)
    await user.clear(within(dialog).getByLabelText('New address'))
    await user.type(within(dialog).getByLabelText('New address'), '/p/eid-2026')
    expect(within(dialog).queryByTestId('redirect-external-warning')).toBeNull()
    await user.click(within(dialog).getByRole('radio', { name: /Moved for now \(302\)/ }))
    await user.click(within(dialog).getByRole('button', { name: 'Add redirect' }))
    expect(await within(dialog).findByText('This address is a live page of your shop.')).toBeInTheDocument()
    expect(bodies[0]).toEqual({ from_path: '/p/eid-2025', to_path: '/p/eid-2026', type: 302 })

    await user.click(within(dialog).getByRole('button', { name: 'Add redirect' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add a redirect' })).toBeNull())
    expect(toastSuccess).toHaveBeenCalledWith('/p/eid-2025 now goes to /p/eid-2026.')
  })

  it('edits an automatic redirect (PATCH) and deletes one', async () => {
    const user = userEvent.setup()
    const calls: { method: string; body: unknown }[] = []
    mockApi({
      'GET /auth/me': ok(manager()),
      'GET /storefront/redirects': page([AUTO, MANUAL]),
      'PATCH /storefront/redirects/r-1': (init) => {
        calls.push({ method: 'PATCH', body: JSON.parse(String(init.body)) })
        return ok({ ...AUTO, to_path: '/product/red-saree-2' })
      },
      'DELETE /storefront/redirects/r-2': () => {
        calls.push({ method: 'DELETE', body: null })
        return { status: 204 }
      },
    })
    renderRoutes(routes, '/storefront/redirects')
    await user.click(await screen.findByRole('button', { name: 'Edit redirect /product/old-saree' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit redirect' })
    expect(within(dialog).getByText(/added automatically/)).toBeInTheDocument()
    expect(within(dialog).getByRole('radio', { name: /Moved for good/ })).toBeChecked()
    const to = within(dialog).getByLabelText('New address')
    await user.clear(to)
    await user.type(to, '/product/red-saree-2')
    await user.click(within(dialog).getByRole('button', { name: 'Save redirect' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Edit redirect' })).toBeNull())
    expect(calls[0]).toEqual({ method: 'PATCH', body: { from_path: '/product/old-saree', to_path: '/product/red-saree-2', type: 301 } })

    await user.click(screen.getByRole('button', { name: 'Delete redirect /p/eid-2025' }))
    const confirm = await screen.findByRole('alertdialog', { name: 'Delete the redirect from /p/eid-2025?' })
    await user.click(within(confirm).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(calls.at(-1)?.method).toBe('DELETE'))
    expect(toastSuccess).toHaveBeenCalledWith('Redirect deleted.')
  })

  it('tests an address: the redirect it follows, a live page, or none', async () => {
    const user = userEvent.setup()
    const fetchMock = mockApi({
      'GET /auth/me': ok(manager()),
      'GET /storefront/redirects': page([AUTO]),
      'GET /storefront/redirects/test': (_init, url) => {
        const path = url.searchParams.get('path')
        if (path === '/product/old-saree') return ok({ path, redirect: AUTO, final_path: '/product/red-saree', live: false })
        if (path === '/shop') return ok({ path, redirect: null, final_path: null, live: true })
        return ok({ path, redirect: null, final_path: null, live: false })
      },
    })
    renderRoutes(routes, '/storefront/redirects')
    await screen.findByTestId('redirect-r-1')
    const input = screen.getByLabelText('Address to test')
    const result = screen.getByTestId('redirect-test-result')
    await user.click(screen.getByRole('button', { name: 'Test' }))
    expect(screen.getByText('Enter an address to test, e.g. /p/eid-2025.')).toBeInTheDocument()

    await user.type(input, 'https://shop.example.com/product/old-saree/')
    await user.click(screen.getByRole('button', { name: 'Test' }))
    await waitFor(() => expect(result).toHaveTextContent('/product/old-saree'))
    expect(result).toHaveTextContent('/product/red-saree')
    expect(result).toHaveTextContent('Moved for good (301) · Automatic')
    const sent = new URL(String(fetchMock.mock.calls.at(-1)?.[0]), 'http://localhost')
    expect(sent.searchParams.get('path')).toBe('/product/old-saree')

    await user.clear(input)
    await user.type(input, '/shop')
    await user.click(screen.getByRole('button', { name: 'Test' }))
    await waitFor(() => expect(result).toHaveTextContent('is a live page of your shop'))

    await user.clear(input)
    await user.type(input, '/nothing-here')
    await user.click(screen.getByRole('button', { name: 'Test' }))
    await waitFor(() => expect(result).toHaveTextContent('shows “Page not found”'))
  })

  it('downloads the filtered list as CSV', async () => {
    const user = userEvent.setup()
    const saved = captureDownloads()
    const { exportCalls } = mockApiWithExports({ 'GET /auth/me': ok(manager()), 'GET /storefront/redirects': page([AUTO, MANUAL]) })
    renderRoutes(routes, '/storefront/redirects')
    await screen.findByTestId('redirect-r-1')
    await user.type(screen.getByRole('searchbox', { name: 'Search redirects' }), 'saree')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Download CSV' })).toBeEnabled())
    await new Promise((r) => setTimeout(r, 350))
    await user.click(screen.getByRole('button', { name: 'Download CSV' }))
    await waitFor(() => expect(saved).toHaveLength(1))
    expect(exportCalls[0]!.url.pathname).toBe('/api/v1/storefront/redirects')
    expect(Object.fromEntries(exportCalls[0]!.url.searchParams)).toEqual({ search: 'saree', export: 'csv' })
    expect(saved[0]!.filename).toMatch(/\.csv$/)
    expect(toastSuccess).toHaveBeenCalledWith(expect.stringMatching(/^Downloaded /))
  })
})
