import { afterEach, describe, expect, it } from 'vitest'
import { ApiError } from '@/lib/api/client'
import { mockApi, ok, fail } from '@/test/utils'
import { storeApi } from './http'

function setCookie(value: string | null) {
  document.cookie = value === null ? 'XSRF-TOKEN=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/' : `XSRF-TOKEN=${encodeURIComponent(value)}; path=/`
}

const headerOf = (init: RequestInit | undefined, name: string) => (init?.headers as Record<string, string> | undefined)?.[name]

afterEach(() => setCookie(null))

describe('storefront API client', () => {
  it('sends cookies and echoes the XSRF-TOKEN cookie only on unsafe methods', async () => {
    setCookie('token-1')
    const fetchMock = mockApi({ 'GET /store/cart': ok({ items: [] }), 'POST /store/cart/items': ok({ items: [] }) })

    await storeApi.get('/store/cart')
    await storeApi.post('/store/cart/items', { variant_id: 'v-1', quantity: '1' })

    const [getCall, postCall] = fetchMock.mock.calls
    expect(getCall?.[1]?.credentials).toBe('include')
    expect(headerOf(getCall?.[1], 'X-XSRF-TOKEN')).toBeUndefined()
    expect(postCall?.[1]?.credentials).toBe('include')
    expect(headerOf(postCall?.[1], 'X-XSRF-TOKEN')).toBe('token-1')
  })

  it('on 419 refreshes the CSRF cookie through /store/account/me once and retries with the new token', async () => {
    setCookie('stale')
    let posts = 0
    const fetchMock = mockApi({
      'GET /store/account/me': () => {
        setCookie('fresh')
        return ok(null)
      },
      'POST /store/wishlist/items': (init) => {
        posts += 1
        return headerOf(init, 'X-XSRF-TOKEN') === 'fresh' ? ok({ items: [] }) : fail(419, 'CSRF_TOKEN_MISMATCH', 'Page expired')
      },
    })

    await expect(storeApi.post('/store/wishlist/items', { product_id: 'p-1' })).resolves.toMatchObject({ data: { items: [] } })
    expect(posts).toBe(2)
    expect(fetchMock.mock.calls.map(([url, init]) => `${init?.method ?? 'GET'} ${String(url)}`)).toEqual([
      'POST /api/v1/store/wishlist/items',
      'GET /api/v1/store/account/me',
      'POST /api/v1/store/wishlist/items',
    ])
  })

  it('retries only once: a second 419 is the answer', async () => {
    let posts = 0
    mockApi({
      'GET /store/account/me': ok(null),
      'POST /store/account/login': () => {
        posts += 1
        return fail(419, 'CSRF_TOKEN_MISMATCH', 'Page expired')
      },
    })

    const error = await storeApi.post('/store/account/login', {}).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).status).toBe(419)
    expect(posts).toBe(2)
  })

  it('keeps the original 419 when the refresh fails, and never retries GETs or other errors', async () => {
    const fetchMock = mockApi({
      'GET /store/account/me': fail(500, 'SERVER_ERROR'),
      'DELETE /store/cart': fail(419, 'CSRF_TOKEN_MISMATCH'),
      'GET /store/cart': fail(419, 'CSRF_TOKEN_MISMATCH'),
      'PATCH /store/cart/items/l-1': fail(422, 'INSUFFICIENT_STOCK'),
    })

    await expect(storeApi.delete('/store/cart')).rejects.toMatchObject({ status: 419 })
    await expect(storeApi.get('/store/cart')).rejects.toMatchObject({ status: 419 })
    await expect(storeApi.patch('/store/cart/items/l-1', { quantity: '9' })).rejects.toMatchObject({ code: 'INSUFFICIENT_STOCK' })
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })
})
