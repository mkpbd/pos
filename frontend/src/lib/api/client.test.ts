import { describe, expect, it, vi } from 'vitest'
import { api, ApiError } from '@/lib/api/client'
import { mockFetchJson } from '@/test/utils'

describe('api client', () => {
  it('returns the success envelope and builds the versioned URL with query params', async () => {
    const fetchMock = mockFetchJson({ success: true, data: { id: 1 }, meta: { request_id: 'r-1' } })

    const res = await api.get<{ id: number }>('/products', { query: { page: 2, search: 'milk', empty: '', skip: undefined } })

    expect(res.data).toEqual({ id: 1 })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/v1/products?page=2&search=milk')
    expect(init.credentials).toBe('include')
    expect((init.headers as Record<string, string>).Accept).toBe('application/json')
  })

  it('throws ApiError carrying code, details and request id', async () => {
    mockFetchJson(
      {
        success: false,
        error: { code: 'VALIDATION_FAILED', message: 'The given data was invalid.', details: { name: ['Required'] } },
        meta: { request_id: 'r-2' },
      },
      { status: 422 },
    )

    const error = await api.post('/products', {}).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ApiError)
    const apiError = error as ApiError
    expect(apiError.status).toBe(422)
    expect(apiError.code).toBe('VALIDATION_FAILED')
    expect(apiError.fieldErrors).toEqual({ name: ['Required'] })
    expect(apiError.requestId).toBe('r-2')
  })

  it('returns success envelopes even on non-2xx status', async () => {
    mockFetchJson({ success: true, data: { status: 'degraded' }, meta: { request_id: null } }, { status: 503 })

    const res = await api.get<{ status: string }>('/health')

    expect(res.data.status).toBe('degraded')
  })

  it('sends JSON body, idempotency key and XSRF token on mutations', async () => {
    document.cookie = 'XSRF-TOKEN=abc%3D123'
    const fetchMock = mockFetchJson({ success: true, data: null, meta: { request_id: null } }, { status: 201 })

    await api.post('/pos/checkout', { total: '10.00' }, { idempotencyKey: 'key-1' })

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    const headers = init.headers as Record<string, string>
    expect(init.method).toBe('POST')
    expect(init.body).toBe('{"total":"10.00"}')
    expect(headers['Content-Type']).toBe('application/json')
    expect(headers['Idempotency-Key']).toBe('key-1')
    expect(headers['X-XSRF-TOKEN']).toBe('abc=123')
  })

  it('maps network failures to NETWORK_ERROR', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))))

    await expect(api.get('/health')).rejects.toMatchObject({ code: 'NETWORK_ERROR', status: 0 })
  })

  it('maps non-JSON responses to INVALID_RESPONSE', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>502</html>', { status: 502 })))

    await expect(api.get('/health')).rejects.toMatchObject({ code: 'INVALID_RESPONSE', status: 502 })
  })

  it('handles 204 No Content', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 204 })))

    const res = await api.delete('/products/1')

    expect(res.success).toBe(true)
    expect(res.data).toBeUndefined()
  })
})
