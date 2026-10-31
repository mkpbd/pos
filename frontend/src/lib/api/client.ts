/**
 * Thin, typed wrapper around fetch for the Laravel /api/v1 envelope.
 *
 * Rules:
 * - The envelope is authoritative: a body with `success: true` is returned even on
 *   non-2xx statuses (e.g. /health answers 503 with a degraded report).
 * - Everything else becomes an ApiError with the server's machine-readable code.
 * - Cookies are always sent (Sanctum SPA auth); the XSRF-TOKEN cookie is echoed
 *   back as X-XSRF-TOKEN on state-changing requests.
 */

export const API_BASE = '/api/v1'

export type Pagination = {
  current_page: number
  per_page: number
  total: number
  last_page: number
}

export type ApiMeta = {
  request_id: string | null
  pagination?: Pagination
}

export type Paginated<T> = {
  items: T[]
  pagination: Pagination
}

/** Unwraps a paginated envelope into items + pagination. */
export function toPaginated<T>(res: ApiSuccess<T[]>): Paginated<T> {
  return {
    items: res.data,
    pagination: res.meta.pagination ?? { current_page: 1, per_page: res.data.length, total: res.data.length, last_page: 1 },
  }
}

export type ApiSuccess<T> = {
  success: true
  data: T
  meta: ApiMeta
}

export type ApiFailure = {
  success: false
  error: { code: string; message: string; details: Record<string, unknown> }
  meta: ApiMeta
}

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly details: Record<string, unknown>
  readonly requestId: string | null

  constructor(status: number, code: string, message: string, details: Record<string, unknown> = {}, requestId: string | null = null) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
    this.requestId = requestId
  }

  /** Field errors from a VALIDATION_FAILED response, keyed by field name. */
  get fieldErrors(): Record<string, string[]> {
    if (this.code !== 'VALIDATION_FAILED') return {}
    return this.details as Record<string, string[]>
  }
}

type QueryValue = string | number | boolean | null | undefined

export type RequestOptions = {
  query?: Record<string, QueryValue>
  body?: unknown
  signal?: AbortSignal
  headers?: Record<string, string>
  /** Sent as Idempotency-Key; required by checkout and payment endpoints. */
  idempotencyKey?: string
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

let contextHeaders: () => Record<string, string> = () => ({})

/**
 * Register a provider for headers that depend on app state (e.g. X-Branch-Id).
 * Kept as an injection point so the client has no dependency on stores.
 */
export function setContextHeaderProvider(provider: () => Record<string, string>): void {
  contextHeaders = provider
}

/**
 * Sanctum SPA auth: obtain the XSRF-TOKEN cookie before the first state-changing request.
 */
export async function ensureCsrfCookie(): Promise<void> {
  if (readCookie('XSRF-TOKEN')) return
  try {
    await fetch('/sanctum/csrf-cookie', { credentials: 'include', headers: { Accept: 'application/json' } })
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Cannot reach the server. Check your connection.')
  }
}

const SAFE_METHODS: ReadonlySet<Method> = new Set(['GET'])

function buildUrl(path: string, query?: RequestOptions['query']): string {
  const url = `${API_BASE}${path.startsWith('/') ? path : `/${path}`}`
  if (!query) return url

  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') params.append(key, String(value))
  }
  const qs = params.toString()
  return qs ? `${url}?${qs}` : url
}

function readCookie(name: string): string | null {
  const match = document.cookie.split('; ').find((row) => row.startsWith(`${name}=`))
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null
}

function isEnvelope(value: unknown): value is ApiSuccess<unknown> | ApiFailure {
  return typeof value === 'object' && value !== null && 'success' in value
}

export async function request<T>(method: Method, path: string, options: RequestOptions = {}): Promise<ApiSuccess<T>> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'X-Requested-With': 'XMLHttpRequest',
    ...contextHeaders(),
    ...options.headers,
  }

  const isMultipart = options.body instanceof FormData
  // FormData: the browser sets multipart/form-data with its boundary.
  if (options.body !== undefined && !isMultipart) headers['Content-Type'] = 'application/json'
  if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey
  if (!SAFE_METHODS.has(method)) {
    const xsrf = readCookie('XSRF-TOKEN')
    if (xsrf) headers['X-XSRF-TOKEN'] = xsrf
  }

  let response: Response
  try {
    response = await fetch(buildUrl(path, options.query), {
      method,
      headers,
      credentials: 'include',
      body: options.body === undefined ? undefined : isMultipart ? (options.body as FormData) : JSON.stringify(options.body),
      signal: options.signal,
    })
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause
    throw new ApiError(0, 'NETWORK_ERROR', 'Cannot reach the server. Check your connection.')
  }

  const requestId = response.headers.get('X-Request-Id')

  if (response.status === 204) {
    return { success: true, data: undefined as T, meta: { request_id: requestId } }
  }

  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    throw new ApiError(response.status, 'INVALID_RESPONSE', 'The server returned an unexpected response.', {}, requestId)
  }

  if (isEnvelope(payload)) {
    if (payload.success) return payload as ApiSuccess<T>
    throw new ApiError(response.status, payload.error.code, payload.error.message, payload.error.details ?? {}, payload.meta?.request_id ?? requestId)
  }

  throw new ApiError(response.status, 'INVALID_RESPONSE', 'The server returned an unexpected response.', {}, requestId)
}

export const api = {
  get: <T>(path: string, options?: Omit<RequestOptions, 'body'>) => request<T>('GET', path, options),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) => request<T>('POST', path, { ...options, body }),
  put: <T>(path: string, body?: unknown, options?: RequestOptions) => request<T>('PUT', path, { ...options, body }),
  patch: <T>(path: string, body?: unknown, options?: RequestOptions) => request<T>('PATCH', path, { ...options, body }),
  delete: <T = void>(path: string, options?: RequestOptions) => request<T>('DELETE', path, options),
}
