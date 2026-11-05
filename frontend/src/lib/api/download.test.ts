import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/lib/api/client'
import { downloadFile, filenameFromContentDisposition } from '@/lib/api/download'
import { captureDownloads, errorResponse, fileResponse, XLSX_TYPE } from '@/features/exports/testing'
import { useSessionStore } from '@/stores/session-store'

function stubFetch(response: Response | (() => Promise<Response>)) {
  const fetchMock = vi.fn(async () => (typeof response === 'function' ? response() : response))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('filenameFromContentDisposition', () => {
  it('reads quoted, bare and RFC 5987 filenames', () => {
    expect(filenameFromContentDisposition('attachment; filename="sales-corner-shop-20261105-1430.xlsx"')).toBe('sales-corner-shop-20261105-1430.xlsx')
    expect(filenameFromContentDisposition('attachment; filename=stock.pdf')).toBe('stock.pdf')
    expect(filenameFromContentDisposition(`attachment; filename="fallback.xlsx"; filename*=UTF-8''%E0%A6%AC%E0%A6%BF%E0%A6%95%E0%A7%8D%E0%A6%B0%E0%A6%AF%E0%A6%BC.xlsx`)).toBe('বিক্রয়.xlsx')
  })

  it('returns null without a usable name and strips path characters', () => {
    expect(filenameFromContentDisposition(null)).toBeNull()
    expect(filenameFromContentDisposition('attachment')).toBeNull()
    expect(filenameFromContentDisposition('attachment; filename="../../etc/passwd"')).toBe('..-..-etc-passwd')
  })

  it('falls back to the plain filename when filename* is malformed', () => {
    expect(filenameFromContentDisposition(`attachment; filename*=UTF-8''%E0%A6; filename="ok.pdf"`)).toBe('ok.pdf')
  })
})

describe('downloadFile', () => {
  beforeEach(() => {
    useSessionStore.setState({ activeBranchId: 'b-2' })
    document.cookie = 'XSRF-TOKEN=tok%3D1'
  })

  afterEach(() => {
    useSessionStore.setState({ activeBranchId: null })
    document.cookie = 'XSRF-TOKEN=; expires=Thu, 01 Jan 1970 00:00:00 GMT'
  })

  it('sends the API client credentials and headers, then saves the file under the server name', async () => {
    const saved = captureDownloads()
    const fetchMock = stubFetch(fileResponse('sales-corner-shop-20261105-1430.xlsx'))

    const file = await downloadFile('/sales', { query: { status: 'completed', search: '', from: undefined, export: 'xlsx' }, fallbackFilename: 'sales.xlsx' })

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/v1/sales?status=completed&export=xlsx')
    expect(init.method).toBe('GET')
    expect(init.credentials).toBe('include')
    const headers = init.headers as Record<string, string>
    expect(headers['X-Branch-Id']).toBe('b-2')
    expect(headers['X-XSRF-TOKEN']).toBe('tok=1')
    expect(headers['X-Requested-With']).toBe('XMLHttpRequest')
    expect(headers.Accept).toMatch(/^application\/json/)

    expect(file).toEqual({ filename: 'sales-corner-shop-20261105-1430.xlsx', size: 10, contentType: XLSX_TYPE })
    expect(saved).toHaveLength(1)
    expect(saved[0]?.filename).toBe('sales-corner-shop-20261105-1430.xlsx')
    expect(saved[0]?.blob?.size).toBe(10)
    expect(URL.revokeObjectURL).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith(saved[0]?.href), { timeout: 3000 })
    expect(document.querySelector('a[download]')).toBeNull()
  })

  it('uses the fallback name when Content-Disposition is missing', async () => {
    const saved = captureDownloads()
    stubFetch(new Response('%PDF', { status: 200, headers: { 'Content-Type': 'application/pdf' } }))

    const file = await downloadFile('/inventory/stock', { fallbackFilename: 'stock-levels.pdf' })

    expect(file.filename).toBe('stock-levels.pdf')
    expect(saved[0]?.filename).toBe('stock-levels.pdf')
  })

  it('turns the error envelope into an ApiError with its code and details', async () => {
    const saved = captureDownloads()
    stubFetch(errorResponse(422, 'EXPORT_TOO_LARGE', 'Too many rows.', { limit: 2000, rows: 2412 }))

    const error = await downloadFile('/sales', { query: { export: 'pdf' }, fallbackFilename: 'sales.pdf' }).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 422, code: 'EXPORT_TOO_LARGE', details: { limit: 2000, rows: 2412 }, requestId: 'test' })
    expect(saved).toHaveLength(0)
  })

  it('rejects a JSON success body (the endpoint ignored export) and non-JSON errors', async () => {
    captureDownloads()
    stubFetch(new Response(JSON.stringify({ success: true, data: [], meta: { request_id: null } }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    await expect(downloadFile('/sales', { fallbackFilename: 'sales.xlsx' })).rejects.toMatchObject({ code: 'INVALID_RESPONSE', status: 200 })

    stubFetch(new Response('<html>Bad gateway</html>', { status: 502, headers: { 'Content-Type': 'text/html' } }))
    await expect(downloadFile('/sales', { fallbackFilename: 'sales.xlsx' })).rejects.toMatchObject({ code: 'INVALID_RESPONSE', status: 502 })
  })

  it('reports network failures and passes aborts through', async () => {
    stubFetch(() => Promise.reject(new TypeError('Failed to fetch')))
    await expect(downloadFile('/sales', { fallbackFilename: 'sales.xlsx' })).rejects.toMatchObject({ code: 'NETWORK_ERROR', status: 0 })

    stubFetch(() => Promise.reject(new DOMException('Aborted', 'AbortError')))
    await expect(downloadFile('/sales', { fallbackFilename: 'sales.xlsx' })).rejects.toMatchObject({ name: 'AbortError' })
  })
})
