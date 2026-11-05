/**
 * Test helpers for list exports (X1): serve export requests as files on top of mockApi,
 * and capture what the browser was asked to save. Imported by tests only.
 */
import { vi } from 'vitest'
import { mockApi } from '@/test/utils'

export const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

export function fileResponse(filename: string, contentType = XLSX_TYPE, body = 'file-bytes'): Response {
  // A string body: jsdom's Blob is not one the fetch Response understands.
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': contentType, 'Content-Disposition': `attachment; filename="${filename}"`, 'Cache-Control': 'no-store' },
  })
}

export function errorResponse(status: number, code: string, message = code, details: Record<string, unknown> = {}): Response {
  return new Response(JSON.stringify({ success: false, error: { code, message, details }, meta: { request_id: 'test' } }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

type ExportReply = (url: URL) => Response | Promise<Response>

/**
 * mockApi plus export handling: requests carrying `export=` get `reply(url)` (default: a file named
 * after the path and format); everything else goes to the JSON route mocks.
 */
export function mockApiWithExports(routes: Parameters<typeof mockApi>[0], reply?: ExportReply) {
  const apiMock = mockApi(routes)
  const exportCalls: { url: URL; init: RequestInit }[] = []
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input), 'http://localhost')
    if (!url.searchParams.has('export')) return apiMock(input, init)
    exportCalls.push({ url, init })
    if (reply) return reply(url)
    const name = url.pathname.replace(/^\/api\/v1\//, '').replace(/\//g, '-')
    const format = url.searchParams.get('export') ?? 'xlsx'
    return fileResponse(`${name}-corner-shop-20261105-1430.${format}`, format === 'pdf' ? 'application/pdf' : XLSX_TYPE)
  })
  vi.stubGlobal('fetch', fetchMock)
  return { fetchMock, exportCalls }
}

/** Stubs object URLs and anchor clicks; returns the files the page "saved". */
export function captureDownloads() {
  const saved: { filename: string; href: string; blob: Blob | null }[] = []
  const blobs = new Map<string, Blob>()
  let n = 0
  // jsdom has no object URLs; define them so they can be spied on.
  for (const name of ['createObjectURL', 'revokeObjectURL'] as const) {
    if (typeof URL[name] !== 'function') Object.defineProperty(URL, name, { value: () => '', writable: true, configurable: true })
  }
  vi.spyOn(URL, 'createObjectURL').mockImplementation((obj: Blob | MediaSource) => {
    const href = `blob:http://localhost/file-${++n}`
    if (obj instanceof Blob) blobs.set(href, obj)
    return href
  })
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    saved.push({ filename: this.download, href: this.href, blob: blobs.get(this.href) ?? null })
  })
  return saved
}
