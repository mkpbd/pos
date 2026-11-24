import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { routes } from '@/app/routes'
import { makeErrorEvent, platformAdmin } from '@/features/system/testing'
import { makeCurrentUser } from '@/test/fixtures'
import { fail, mockApi, ok, renderRoutes } from '@/test/utils'

const toastSuccess = vi.hoisted(() => vi.fn())
vi.mock('sonner', async (importOriginal) => {
  const original = await importOriginal<typeof import('sonner')>()
  return { ...original, toast: Object.assign(vi.fn(), { ...original.toast, success: toastSuccess }) }
})

beforeEach(() => toastSuccess.mockReset())

const paged = (items: unknown[]) => ok(items, { pagination: { current_page: 1, per_page: 25, total: items.length, last_page: 1 } })
const { trace: _trace, ...listRow } = makeErrorEvent()

describe('SystemErrorsPage (G1b)', () => {
  it('lists open errors and filters by status, search and sort', async () => {
    const user = userEvent.setup()
    const queries: URLSearchParams[] = []
    mockApi({
      'GET /auth/me': ok(platformAdmin()),
      'GET /platform/system/errors': (_init, url) => {
        queries.push(url.searchParams)
        return url.searchParams.get('status') === 'resolved'
          ? paged([])
          : paged([listRow, { ...listRow, id: 'er-2', exception_class: 'TypeError', message: 'Cannot read properties', occurrences: '1250', last_path: null, last_method: null }])
      },
    })
    renderRoutes(routes, '/system-status/errors')

    const table = await screen.findByRole('table', { name: 'Open errors' })
    const rows = within(table).getAllByRole('row')
    expect(rows).toHaveLength(3)
    expect(within(rows[1]!).getByRole('link', { name: 'QueryException' })).toHaveAttribute('href', '/system-status/errors/er-1')
    expect(rows[1]).toHaveTextContent('POST /api/v1/pos/checkout')
    expect(rows[1]).toHaveTextContent('5 min ago')
    expect(rows[2]).toHaveTextContent('1,250')
    expect(rows[2]).toHaveTextContent('app/Modules/Sales/Application/Actions/CompleteSale.php:120')
    expect(queries[0]?.get('status')).toBe('open')
    expect(queries[0]?.get('sort')).toBe('-last_seen_at')

    await user.click(screen.getByRole('combobox', { name: 'Sort by' }))
    await user.click(await screen.findByRole('option', { name: 'Most frequent' }))
    await waitFor(() => expect(queries.at(-1)?.get('sort')).toBe('-occurrences'))

    await user.type(screen.getByLabelText('Search'), 'checkout')
    await waitFor(() => expect(queries.at(-1)?.get('search')).toBe('checkout'))

    await user.click(screen.getByRole('tab', { name: 'Resolved' }))
    expect(await screen.findByText('No errors')).toBeInTheDocument()
    expect(queries.at(-1)?.get('status')).toBe('resolved')
  })

  it('opens an error and resolves it', async () => {
    const user = userEvent.setup()
    let current = makeErrorEvent()
    const patches: unknown[] = []
    mockApi({
      'GET /auth/me': ok(platformAdmin()),
      'GET /platform/system/errors': paged([listRow]),
      'GET /platform/system/errors/er-1': () => ok(current),
      'PATCH /platform/system/errors/er-1': (init) => {
        const body = JSON.parse(String(init.body)) as { status: 'resolved' }
        patches.push(body)
        current = { ...current, status: body.status, resolved_at: new Date().toISOString() }
        const { trace: _omit, ...row } = current
        return ok(row)
      },
    })
    renderRoutes(routes, '/system-status/errors')

    await user.click(await screen.findByRole('link', { name: 'QueryException' }))

    expect(await screen.findByRole('heading', { level: 1, name: 'QueryException' })).toBeInTheDocument()
    expect(screen.getByText('Illuminate\\Database\\QueryException')).toBeInTheDocument()
    expect(screen.getByText('SQLSTATE[23505]: insert into "sales" ("number") values (?)')).toBeInTheDocument()
    expect(screen.getByText('app/Modules/Sales/Application/Actions/CompleteSale.php:120')).toBeInTheDocument()
    expect(screen.getByText('POST /api/v1/pos/checkout')).toBeInTheDocument()
    expect(screen.getByText('req-abc-123')).toBeInTheDocument()
    const trace = screen.getByLabelText('Stack trace')
    expect(trace).toHaveTextContent('#1 app/Modules/Sales/Presentation/Http/Controllers/CheckoutController.php(40): handle()')
    expect(trace).toHaveAttribute('tabindex', '0')

    await user.click(screen.getByRole('button', { name: 'Resolve' }))

    expect(await screen.findByRole('button', { name: 'Reopen' })).toBeInTheDocument()
    expect(screen.getByText('Resolved', { selector: '[data-slot="badge"]' })).toBeInTheDocument()
    expect(patches).toEqual([{ status: 'resolved' }])
    expect(toastSuccess).toHaveBeenCalled()
    // The PATCH answer has no trace; the loaded one stays.
    expect(screen.getByLabelText('Stack trace')).toHaveTextContent('CheckoutController.php(40)')
  })

  it('shows a missing error as not found', async () => {
    mockApi({ 'GET /auth/me': ok(platformAdmin()), 'GET /platform/system/errors/gone': fail(404, 'NOT_FOUND', 'Not found.') })
    renderRoutes(routes, '/system-status/errors/gone')

    expect(await screen.findByText('Error not found')).toBeInTheDocument()
  })

  it('keeps everyone else out', async () => {
    const fetchMock = mockApi({ 'GET /auth/me': ok(makeCurrentUser()) })
    renderRoutes(routes, '/system-status/errors/er-1')

    expect(await screen.findByRole('heading', { name: 'Access denied' })).toBeInTheDocument()
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/platform/system'))).toBe(false)
  })
})
