import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ExportMenu } from '@/components/common/export-menu'
import { exportErrorMessage } from '@/features/exports/errors'
import { exportEndpoint, fallbackExportFilename } from '@/features/exports/lists'
import { captureDownloads, errorResponse, fileResponse, mockApiWithExports } from '@/features/exports/testing'
import { ApiError } from '@/lib/api/client'

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

async function choose(format: 'Excel (.xlsx)' | 'CSV (.csv)' | 'PDF') {
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'Export' }))
  await user.click(await screen.findByRole('menuitem', { name: format }))
}

describe('ExportMenu', () => {
  it('downloads Excel with the list filters and sort but without paging', async () => {
    const saved = captureDownloads()
    const { exportCalls } = mockApiWithExports({}, () => fileResponse('sales-corner-shop-20261105-1430.xlsx'))
    render(<ExportMenu list="sales" query={{ page: 3, per_page: 25, search: 'INV-7', status: 'completed', from: '2026-11-01', to: undefined, sort: '-sold_at' }} />)

    await choose('Excel (.xlsx)')

    await waitFor(() => expect(saved).toHaveLength(1))
    expect(exportCalls).toHaveLength(1)
    const url = exportCalls[0]!.url
    expect(url.pathname).toBe('/api/v1/sales')
    expect(Object.fromEntries(url.searchParams)).toEqual({ search: 'INV-7', status: 'completed', from: '2026-11-01', sort: '-sold_at', export: 'xlsx' })
    expect(saved[0]?.filename).toBe('sales-corner-shop-20261105-1430.xlsx')
    expect(toastSuccess).toHaveBeenCalledWith('Downloaded sales-corner-shop-20261105-1430.xlsx')
    expect(toastError).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Export' })).toBeEnabled()
  })

  it('downloads a PDF and fills path parameters', async () => {
    const saved = captureDownloads()
    const { exportCalls } = mockApiWithExports({}, () => fileResponse('customer-statement-corner-shop-20261105-1430.pdf', 'application/pdf'))
    render(<ExportMenu list="customerStatement" pathParams={{ id: 'c 1' }} />)

    await choose('PDF')

    await waitFor(() => expect(saved).toHaveLength(1))
    expect(exportCalls[0]!.url.pathname).toBe('/api/v1/customers/c%201/statement')
    expect(exportCalls[0]!.url.search).toBe('?export=pdf')
    expect(saved[0]?.filename).toBe('customer-statement-corner-shop-20261105-1430.pdf')
  })

  it('offers Excel, CSV and PDF; CSV keeps the filters (Phase 7)', async () => {
    const user = userEvent.setup()
    const saved = captureDownloads()
    const { exportCalls } = mockApiWithExports({}, () => fileResponse('report-corner-shop-20261105-1430.csv', 'text/csv; charset=UTF-8'))
    render(<ExportMenu list="report" pathParams={{ key: 'sales_daily' }} title="Daily sales" query={{ date_from: '2026-11-01', date_to: '2026-11-07', page: 2 }} />)

    await user.click(screen.getByRole('button', { name: 'Export' }))
    expect((await screen.findAllByRole('menuitem')).map((m) => m.textContent?.trim())).toEqual(['Excel (.xlsx)', 'CSV (.csv)', 'PDF'])
    expect(screen.getByText('Daily sales — all matching rows')).toBeInTheDocument()
    await user.click(screen.getByRole('menuitem', { name: 'CSV (.csv)' }))

    await waitFor(() => expect(saved).toHaveLength(1))
    expect(exportCalls[0]!.url.pathname).toBe('/api/v1/reports/sales_daily')
    expect(Object.fromEntries(exportCalls[0]!.url.searchParams)).toEqual({ date_from: '2026-11-01', date_to: '2026-11-07', export: 'csv' })
    expect(fallbackExportFilename('report', 'csv', 'Daily sales')).toBe('daily-sales.csv')
  })

  it('shows a busy button while the file is prepared', async () => {
    captureDownloads()
    let finish: (r: Response) => void = () => {}
    mockApiWithExports({}, () => new Promise<Response>((resolve) => { finish = resolve }))
    render(<ExportMenu list="products" />)

    await choose('PDF')

    const busy = await screen.findByRole('button', { name: 'Exporting…' })
    expect(busy).toBeDisabled()
    expect(busy).toHaveAttribute('aria-busy', 'true')

    finish(fileResponse('products.pdf', 'application/pdf'))
    expect(await screen.findByRole('button', { name: 'Export' })).toBeEnabled()
  })

  it('is disabled when the list is empty', () => {
    render(<ExportMenu list="products" disabled />)
    const button = screen.getByRole('button', { name: 'Export' })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('title', 'Nothing to export')
  })

  it.each([
    [errorResponse(422, 'EXPORT_TOO_LARGE', 'Too many rows.', { limit: 2000, rows: 2412 }), 'PDF', /This list has 2,412 rows\. PDF exports are limited to 2,000 rows — narrow the filters/],
    [errorResponse(503, 'PDF_UNAVAILABLE', 'PDF rendering is unavailable.'), 'PDF', /PDF export is not available right now\. Export to Excel instead/],
    [errorResponse(403, 'FORBIDDEN', 'This action is unauthorized.'), 'Excel (.xlsx)', /You do not have permission to export this list/],
    [errorResponse(429, 'TOO_MANY_REQUESTS', 'Too Many Attempts.'), 'Excel (.xlsx)', /Too many exports in a short time/],
  ] as const)('toasts a clear message for %#', async (response, format, message) => {
    const saved = captureDownloads()
    mockApiWithExports({}, () => response)
    render(<ExportMenu list="sales" />)

    await choose(format)

    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1))
    expect(toastError.mock.calls[0]?.[0]).toMatch(message)
    expect(saved).toHaveLength(0)
    expect(screen.getByRole('button', { name: 'Export' })).toBeEnabled()
  })
})

describe('export helpers', () => {
  it('maps error codes and statuses to messages', () => {
    expect(exportErrorMessage(new ApiError(422, 'EXPORT_TOO_LARGE', 'x', { limit: 50000, rows: '61234' }), 'xlsx')).toBe(
      'This list has 61,234 rows. Excel exports are limited to 50,000 rows — narrow the filters and try again.',
    )
    expect(exportErrorMessage(new ApiError(422, 'EXPORT_TOO_LARGE', 'x'), 'pdf')).toBe('This list is too long. It is too long for a PDF export — narrow the filters and try again.')
    expect(exportErrorMessage(new ApiError(0, 'NETWORK_ERROR', 'x'), 'pdf')).toBe('Cannot reach the server. Check your connection.')
    expect(exportErrorMessage(new ApiError(500, 'SERVER_ERROR', 'Something broke.'), 'pdf')).toBe('Something broke.')
    expect(exportErrorMessage(new Error('boom'), 'pdf')).toBe('The export failed. Please try again.')
  })

  it('builds endpoints and fallback names', () => {
    expect(exportEndpoint('promotionReport', { id: 'p-1' })).toBe('/promotions/p-1/report')
    expect(() => exportEndpoint('supplierStatement')).toThrow(/"id" path parameter/)
    expect(fallbackExportFilename('codRemittances', 'pdf')).toBe('cod-remittances.pdf')
    expect(fallbackExportFilename('expenses', 'xlsx')).toBe('expenses-and-income.xlsx')
  })
})
