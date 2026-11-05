/**
 * File downloads from the Laravel /api/v1 endpoints (list exports, X1).
 *
 * Mirrors the API client: same base URL and query encoding, cookies always sent
 * (Sanctum SPA auth), the XSRF-TOKEN cookie echoed as X-XSRF-TOKEN, and the active
 * branch as X-Branch-Id. A success is a file (blob → object URL → `<a download>`);
 * a failure is the usual JSON envelope and becomes an ApiError with the server code.
 */
import { API_BASE, ApiError, type ApiFailure, type RequestOptions } from '@/lib/api/client'
import { useSessionStore } from '@/stores/session-store'

export type DownloadQuery = NonNullable<RequestOptions['query']>

export type DownloadOptions = {
  query?: DownloadQuery
  signal?: AbortSignal
  /** Used when the response has no usable Content-Disposition filename. */
  fallbackFilename: string
}

export type DownloadedFile = { filename: string; size: number; contentType: string }

function buildUrl(path: string, query?: DownloadQuery): string {
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

/** Same headers as the API client; the active branch comes from the session store, as in main.tsx. */
function requestHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    // JSON first so failures come back as the error envelope; the file itself ignores it.
    Accept: 'application/json, */*;q=0.8',
    'X-Requested-With': 'XMLHttpRequest',
  }
  const branchId = useSessionStore.getState().activeBranchId
  if (branchId) headers['X-Branch-Id'] = branchId
  const xsrf = readCookie('XSRF-TOKEN')
  if (xsrf) headers['X-XSRF-TOKEN'] = xsrf
  return headers
}

/** Strips characters a file system would reject; keeps Unicode (Bangla) names intact. */
function safeFilename(name: string): string {
  const cleaned = Array.from(name, (ch) => (ch.charCodeAt(0) < 0x20 || '/\\?%*:|"<>'.includes(ch) ? '-' : ch)).join('').trim()
  return cleaned === '' || cleaned === '.' || cleaned === '..' ? '' : cleaned
}

/**
 * Filename from a Content-Disposition header: RFC 5987 `filename*` wins over `filename`.
 * Returns null when the header is missing or names no file.
 */
export function filenameFromContentDisposition(header: string | null): string | null {
  if (!header) return null

  const extended = /filename\*\s*=\s*([^']*)'[^']*'([^;]+)/i.exec(header)
  if (extended?.[2]) {
    try {
      const name = safeFilename(decodeURIComponent(extended[2].trim().replace(/^"|"$/g, '')))
      if (name) return name
    } catch {
      // Malformed percent-encoding: fall back to the plain filename.
    }
  }

  const plain = /filename\s*=\s*("((?:\\.|[^"\\])*)"|[^;]+)/i.exec(header)
  if (plain) {
    const raw = plain[2] !== undefined ? plain[2].replace(/\\(.)/g, '$1') : (plain[1] ?? '').trim()
    const name = safeFilename(raw)
    if (name) return name
  }

  return null
}

/** Hands a blob to the browser as a download and releases the object URL afterwards. */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.rel = 'noopener'
  link.style.display = 'none'
  document.body.appendChild(link)
  try {
    link.click()
  } finally {
    link.remove()
    // Some browsers read the URL after click() returns; release it on the next turn.
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
}

function isFailureEnvelope(value: unknown): value is ApiFailure {
  return typeof value === 'object' && value !== null && 'success' in value && (value as { success: unknown }).success === false && 'error' in value
}

async function toApiError(response: Response): Promise<ApiError> {
  const requestId = response.headers.get('X-Request-Id')
  let payload: unknown = null
  try {
    payload = await response.json()
  } catch {
    // Not JSON (e.g. a proxy error page): fall through to a status-based error.
  }
  if (isFailureEnvelope(payload)) {
    return new ApiError(response.status, payload.error.code, payload.error.message, payload.error.details ?? {}, payload.meta?.request_id ?? requestId)
  }
  return new ApiError(response.status, 'INVALID_RESPONSE', 'The server returned an unexpected response.', {}, requestId)
}

/**
 * GET a file and save it. Resolves with the saved filename; rejects with ApiError
 * (server error envelope, NETWORK_ERROR, INVALID_RESPONSE) or the AbortError.
 */
export async function downloadFile(path: string, options: DownloadOptions): Promise<DownloadedFile> {
  let response: Response
  try {
    response = await fetch(buildUrl(path, options.query), {
      method: 'GET',
      headers: requestHeaders(),
      credentials: 'include',
      signal: options.signal,
    })
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause
    throw new ApiError(0, 'NETWORK_ERROR', 'Cannot reach the server. Check your connection.')
  }

  const contentType = response.headers.get('Content-Type') ?? ''
  // A file never comes as JSON; a JSON body is the error envelope (or an unexpected list).
  if (!response.ok || contentType.includes('application/json')) throw await toApiError(response)

  const blob = await response.blob()
  const filename = filenameFromContentDisposition(response.headers.get('Content-Disposition')) ?? options.fallbackFilename
  saveBlob(blob, filename)
  return { filename, size: blob.size, contentType }
}
