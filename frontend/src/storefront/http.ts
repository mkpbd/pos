import { ApiError, request, type ApiSuccess, type RequestOptions } from '@/lib/api/client'
import { getLocaleRuntime } from './i18n/runtime'

/**
 * The storefront's API client. It builds on the shared envelope client, which already sends
 * cookies and echoes the XSRF-TOKEN cookie as X-XSRF-TOKEN on POST/PUT/PATCH/DELETE.
 *
 * Storefront hosts are not Sanctum-stateful, so the session and CSRF cookie come from the
 * `storefront.session` middleware: GET /store/account/me (and the bootstrap) issue the cookie.
 * When an unsafe request is rejected with 419 (no or a stale token — first visit, expired
 * session), the cookie is refreshed by fetching /store/account/me once and the request is
 * retried exactly once.
 *
 * Every /store/* request carries the shopper's language as `?lang=` (ADR-011): the public API
 * resolves the language only from the URL, so HTTP caches keep one entry per language. An
 * explicit `lang` in the query wins (the first bootstrap asks for the requested language).
 */

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export const CSRF_REFRESH_PATH = '/store/account/me'

function withLang(path: string, options: RequestOptions): [string, RequestOptions] {
  const { lang } = getLocaleRuntime()
  if (!lang || !path.startsWith('/store/') || (options.query && 'lang' in options.query)) return [path, options]
  // A path that already has its query string (repeatable filters) gets the parameter appended.
  const [base = path, search = ''] = path.split('?', 2)
  if (path.includes('?')) {
    const params = new URLSearchParams(search)
    if (params.has('lang')) return [path, options]
    params.set('lang', lang)
    return [`${base}?${params.toString()}`, options]
  }
  return [path, { ...options, query: { ...options.query, lang } }]
}

export async function storeRequest<T>(method: Method, requestPath: string, requestOptions: RequestOptions = {}): Promise<ApiSuccess<T>> {
  const [path, options] = withLang(requestPath, requestOptions)
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
