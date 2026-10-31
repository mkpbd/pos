import { ApiError, request, type ApiSuccess, type RequestOptions } from '@/lib/api/client'

/**
 * The storefront's API client. It builds on the shared envelope client, which already sends
 * cookies and echoes the XSRF-TOKEN cookie as X-XSRF-TOKEN on POST/PUT/PATCH/DELETE.
 *
 * Storefront hosts are not Sanctum-stateful, so the session and CSRF cookie come from the
 * `storefront.session` middleware: GET /store/account/me (and the bootstrap) issue the cookie.
 * When an unsafe request is rejected with 419 (no or a stale token — first visit, expired
 * session), the cookie is refreshed by fetching /store/account/me once and the request is
 * retried exactly once.
 */

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export const CSRF_REFRESH_PATH = '/store/account/me'

export async function storeRequest<T>(method: Method, path: string, options: RequestOptions = {}): Promise<ApiSuccess<T>> {
  try {
    return await request<T>(method, path, options)
  } catch (error) {
    if (method === 'GET' || !(error instanceof ApiError) || error.status !== 419) throw error
    // A failed refresh leaves the original 419 as the answer.
    try {
      await request<unknown>('GET', CSRF_REFRESH_PATH)
    } catch {
      throw error
    }
    return request<T>(method, path, options)
  }
}

export const storeApi = {
  get: <T>(path: string, options?: Omit<RequestOptions, 'body'>) => storeRequest<T>('GET', path, options),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) => storeRequest<T>('POST', path, { ...options, body }),
  put: <T>(path: string, body?: unknown, options?: RequestOptions) => storeRequest<T>('PUT', path, { ...options, body }),
  patch: <T>(path: string, body?: unknown, options?: RequestOptions) => storeRequest<T>('PATCH', path, { ...options, body }),
  delete: <T = void>(path: string, options?: RequestOptions) => storeRequest<T>('DELETE', path, options),
}
