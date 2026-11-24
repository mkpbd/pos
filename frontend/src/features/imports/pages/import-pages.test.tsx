import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { routes } from '@/app/routes'
import { makeCurrentUser } from '@/test/fixtures'
import { fail, mockApi, ok, renderRoutes } from '@/test/utils'

const toastSuccess = vi.hoisted(() => vi.fn())
const toastError = vi.hoisted(() => vi.fn())
vi.mock('sonner', async (importOriginal) => {
  const original = await importOriginal<typeof import('sonner')>()
  return { ...original, toast: Object.assign(vi.fn(), { ...original.toast, error: toastError, success: toastSuccess }) }
})

beforeEach(() => {
  toastSuccess.mockReset()
  toastError.mockReset()
})

const paged = (items: unknown[]) => ok(items, { pagination: { current_page: 1, per_page: 25, total: items.length, last_page: 1 } })
const importer = (permissions: string[]) => makeCurrentUser({ permissions: ['branches.view', ...permissions] })

const customerType = {
  type: 'customers', label: 'Customers', permission: 'customers.manage', max_rows: 20000,
  columns: [
    { key: 'name', label: 'Name', required: true, example: 'Salma Begum', help: 'Full name' },
    { key: 'phone', label: 'Phone', required: false, example: '01711112222', help: 'Bangladeshi mobile number; used to find existing customers' },
  ],
}
const stockType = { type: 'opening_stock', label: 'Opening stock', permission: 'inventory.adjust', max_rows: 20000, columns: [{ key: 'sku_or_barcode', label: 'SKU or barcode', required: true, example: 'JUICE-1L', help: null }] }

const base = {
  id: 'imp-1', type: 'customers', file_name: 'customers.xlsx', rows_total: null, rows_valid: null, rows_error: null, to_create: null, to_update: null, to_skip: null,
  created: null, updated: null, skipped: null, failed_rows: null, errors: [], errors_truncated: false, options: { update_existing: true },
  created_by: { id: 'u-1', name: 'Rahim Uddin' }, created_at: '2026-11-24T04:00:00Z', validated_at: null, started_at: null, finished_at: null, message: null,
}
const validated = {
  ...base, status: 'validated', rows_total: 120, rows_valid: 117, rows_error: 3, to_create: 100, to_update: 15, to_skip: 2,
  errors: [
    { row: 4, column: 'phone', message: 'The phone number is not valid.' },
    { row: 9, column: 'name', message: 'The name is required.' },
    { row: 9, column: 'phone', message: 'Row 7 has the same phone.' },
  ],
}

describe('NewImportPage', () => {
  it('offers the allowed types, the template and its columns, and uploads the file for checking', async () => {
    const user = userEvent.setup()
    let form: FormData | undefined
    const calls: string[] = []
    mockApi({
      'GET /auth/me': ok(importer(['customers.view', 'customers.manage', 'inventory.adjust'])),
      'GET /imports/types': ok([customerType, stockType]),
      'POST /imports': (init) => {
        form = init.body as FormData
        return { status: 201, body: { success: true, data: { ...base, status: 'validating' }, meta: { request_id: 't' } } }
      },
      'GET /imports/imp-1': () => {
        calls.push('detail')
        return ok({ ...base, status: 'validating' })
      },
    })
    const { router } = renderRoutes(routes, '/imports/new?type=customers')

    const group = await screen.findByRole('radiogroup', { name: 'Import type' })
    expect(within(group).getByRole('radio', { name: 'Customers' })).toBeChecked()
    expect(within(group).getByRole('radio', { name: 'Opening stock' })).not.toBeChecked()
    const columns = screen.getByRole('table', { name: 'Columns for Customers' })
    expect(within(columns).getByText('Bangladeshi mobile number; used to find existing customers')).toBeInTheDocument()
    expect(within(columns).getAllByText('Optional')).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Excel template' })).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Update records that already exist' })).toBeChecked()

    await user.click(screen.getByRole('switch', { name: 'Update records that already exist' }))
    await user.upload(screen.getByLabelText(/^File/), new File(['name,phone\nSalma,01711112222\n'], 'customers.csv', { type: 'text/csv' }))
    await user.click(screen.getByRole('button', { name: 'Upload and check' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/imports/imp-1'))
    expect(form?.get('type')).toBe('customers')
    expect((form!.get('file') as File).name).toBe('customers.csv')
    expect(form?.get('options[update_existing]')).toBe('0')
    expect(await screen.findByText('Checking your file…')).toBeInTheDocument()
  })

  it('hides the update option for opening stock and checks the file before uploading', async () => {
    const user = userEvent.setup({ applyAccept: false })
    let uploaded = false
    mockApi({
      'GET /auth/me': ok(importer(['inventory.adjust'])),
      'GET /imports/types': ok([stockType]),
      'POST /imports': () => {
        uploaded = true
        return ok(base)
      },
    })
    renderRoutes(routes, '/imports/new')

    await user.click(await screen.findByRole('radio', { name: 'Opening stock' }))
    expect(screen.getByText(/one stock adjustment with the reason "Opening stock"/)).toBeInTheDocument()
    expect(screen.queryByRole('switch', { name: 'Update records that already exist' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Upload and check' }))
    expect(await screen.findByText('Choose the file to import.')).toBeInTheDocument()
    await user.upload(screen.getByLabelText(/^File/), new File(['x'], 'stock.pdf', { type: 'application/pdf' }))
    await user.click(screen.getByRole('button', { name: 'Upload and check' }))
    expect(await screen.findByText('Choose an Excel (.xlsx) or CSV (.csv) file.')).toBeInTheDocument()
    expect(uploaded).toBe(false)
  })

  it('lists missing and unknown columns when the header row is wrong', async () => {
    const user = userEvent.setup()
    mockApi({
      'GET /auth/me': ok(importer(['customers.manage'])),
      'GET /imports/types': ok([customerType]),
      'POST /imports': fail(422, 'IMPORT_BAD_HEADERS', 'The file header is not valid.', { missing: ['name'], unknown: ['full name', 'mobile'] }),
    })
    renderRoutes(routes, '/imports/new?type=customers')

    await user.upload(await screen.findByLabelText(/^File/), new File(['full name,mobile\n'], 'list.csv', { type: 'text/csv' }))
    await user.click(screen.getByRole('button', { name: 'Upload and check' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Missing: name')
    expect(alert).toHaveTextContent('Not recognised: full name, mobile')
  })
})

describe('ImportPage', () => {
  it('shows the check result with the first errors and imports the valid rows after confirming', async () => {
    const user = userEvent.setup()
    let ran = 0
    mockApi({
      'GET /auth/me': ok(importer(['customers.view', 'customers.manage'])),
      'GET /imports/imp-1': ok(validated),
      'POST /imports/imp-1/run': () => {
        ran++
        return ok({ ...validated, status: 'importing', started_at: '2026-11-24T04:05:00Z', created: 40, updated: 6, skipped: 0, failed_rows: 0 })
      },
    })
    renderRoutes(routes, '/imports/imp-1')

    expect(await screen.findByRole('heading', { name: 'Customers import' })).toBeInTheDocument()
    const stats = screen.getByLabelText('Check result')
    expect(stats).toHaveTextContent('New100')
    expect(stats).toHaveTextContent('Updated15')
    expect(stats).toHaveTextContent('Skipped2')
    expect(stats).toHaveTextContent('With errors3')
    const errors = screen.getByRole('table', { name: 'Errors' })
    expect(within(errors).getAllByRole('row')).toHaveLength(4)
    expect(within(errors).getByText('The phone number is not valid.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Download all errors (CSV)' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Import 117 rows' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Import 117 rows?' })
    expect(dialog).toHaveTextContent('100 to create, 15 to update. The 3 rows with errors are left out.')
    await user.click(within(dialog).getByRole('button', { name: 'Import' }))

    const progress = await screen.findByRole('progressbar', { name: 'Import progress' })
    expect(progress).toHaveAttribute('aria-valuenow', '39')
    expect(screen.getByText(/46 of 117 rows done/)).toBeInTheDocument()
    expect(ran).toBe(1)
    expect(toastSuccess).toHaveBeenCalledWith('Import started.')
  })

  it('explains a run that is no longer possible', async () => {
    const user = userEvent.setup()
    mockApi({
      'GET /auth/me': ok(importer(['customers.manage'])),
      'GET /imports/imp-1': ok(validated),
      'POST /imports/imp-1/run': fail(409, 'IMPORT_NOT_READY', 'Not ready.'),
    })
    renderRoutes(routes, '/imports/imp-1')

    await user.click(await screen.findByRole('button', { name: 'Import 117 rows' }))
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Import' }))
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('This import cannot be started any more. The page shows where it stands now.'))
  })

  it('blocks importing when no row is valid and shows the finished result', async () => {
    mockApi({
      'GET /auth/me': ok(importer(['customers.manage'])),
      'GET /imports/imp-1': ok({ ...validated, rows_valid: 0, rows_error: 120, to_create: 0, to_update: 0, to_skip: 0 }),
      'GET /imports/imp-2': ok({ ...validated, id: 'imp-2', status: 'completed', created: 99, updated: 15, skipped: 2, failed_rows: 1, finished_at: '2026-11-24T04:06:00Z' }),
    })
    const { router } = renderRoutes(routes, '/imports/imp-1')

    expect(await screen.findByRole('button', { name: 'Import 0 rows' })).toBeDisabled()
    expect(screen.getByRole('alert')).toHaveTextContent('No row can be imported')

    await router.navigate('/imports/imp-2')
    const result = await screen.findByLabelText('Import result')
    expect(result).toHaveTextContent('Created99')
    expect(result).toHaveTextContent('Failed1')
    expect(screen.getByRole('link', { name: 'Go to customers' })).toHaveAttribute('href', '/customers')
  })
})

describe('ImportsPage and entry buttons', () => {
  it('lists past imports', async () => {
    mockApi({
      'GET /auth/me': ok(importer(['products.manage'])),
      'GET /imports': paged([{ ...validated, status: 'completed', created: 99, updated: 15, failed_rows: 0 }]),
    })
    renderRoutes(routes, '/imports')

    const table = await screen.findByRole('table', { name: 'Imports' })
    expect(within(table).getByRole('link', { name: 'customers.xlsx' })).toHaveAttribute('href', '/imports/imp-1')
    expect(within(table).getByText('Completed')).toBeInTheDocument()
    expect(within(table).getByText('99 new · 15 updated')).toBeInTheDocument()
  })

  it('shows import buttons only with the permission for that type', async () => {
    mockApi({
      'GET /auth/me': ok(importer(['products.view', 'products.manage', 'products.view_cost'])),
      'GET /products': paged([]),
      'GET /categories': ok([]),
    })
    renderRoutes(routes, '/products')

    expect(await screen.findByRole('link', { name: 'Import products' })).toHaveAttribute('href', '/imports/new?type=products')
    expect(screen.getByRole('link', { name: 'Update prices' })).toHaveAttribute('href', '/imports/new?type=price_update')
    expect(screen.getByRole('link', { name: 'Print labels' })).toHaveAttribute('href', '/products/labels')
  })

  it('hides them for viewers and blocks the wizard', async () => {
    mockApi({
      'GET /auth/me': ok(importer(['products.view', 'customers.view'])),
      'GET /products': paged([]),
      'GET /categories': ok([]),
    })
    const { router } = renderRoutes(routes, '/products')

    expect(await screen.findByRole('link', { name: 'Print labels' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Import products' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Update prices' })).not.toBeInTheDocument()

    await router.navigate('/imports/new')
    expect(await screen.findByRole('heading', { name: 'Access denied' })).toBeInTheDocument()
  })
})
