import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { storefrontKeys } from '@/features/storefront/api'
import { api, toPaginated, type Paginated } from '@/lib/api/client'
import { downloadFile, type DownloadedFile } from '@/lib/api/download'

/*
 * B16 §5: redirects of the online store (Online store → Redirects). When a public address changes
 * (a page, post, product, category or brand slug) the server adds the old → new redirect itself
 * (`source: auto`); staff add their own (`manual`). The storefront shell answers them with a real
 * 301 / 302; the SPA's 404 asks GET /store/redirects/resolve. Every call needs storefront.manage.
 */

export type RedirectType = 301 | 302
export type RedirectSource = 'auto' | 'manual'

export type StoreRedirect = {
  id: string
  from_path: string
  /** A store path (`/p/eid`) or a full http(s) address. */
  to_path: string
  type: RedirectType
  source: RedirectSource
  hits: number
  last_hit_at: string | null
  created_at?: string | null
  updated_at?: string | null
}

export type RedirectInput = { from_path: string; to_path: string; type: RedirectType }

export type RedirectListParams = { page: number; per_page?: number; search?: string; source?: RedirectSource }

/** What the server answers for "Test a path": the address as it is matched and the redirect it hits (null = none). */
export type RedirectTestResult = { path: string; redirect: StoreRedirect | null; final_path?: string | null; live?: boolean }

export const REDIRECTS_PATH = '/storefront/redirects'
export const REDIRECT_LIMITS = { path: 2048 } as const

export const redirectKeys = {
  all: [...storefrontKeys.all, 'redirects'] as const,
  list: (params: RedirectListParams) => [...storefrontKeys.all, 'redirects', 'list', params] as const,
  test: (path: string) => [...storefrontKeys.all, 'redirects', 'test', path] as const,
}

export function useRedirectsQuery(params: RedirectListParams) {
  return useQuery<Paginated<StoreRedirect>>({
    queryKey: redirectKeys.list(params),
    queryFn: ({ signal }) => api.get<StoreRedirect[]>(REDIRECTS_PATH, { signal, query: params }).then(toPaginated),
    placeholderData: keepPreviousData,
  })
}

export function useSaveRedirectMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: RedirectInput }) =>
      (id ? api.patch<StoreRedirect>(`${REDIRECTS_PATH}/${encodeURIComponent(id)}`, input) : api.post<StoreRedirect>(REDIRECTS_PATH, input)).then((r) => r.data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: redirectKeys.all }),
  })
}

export function useDeleteRedirectMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.delete(`${REDIRECTS_PATH}/${encodeURIComponent(id)}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: redirectKeys.all }),
  })
}

/** "Test a path": which redirect (if any) an address of the store follows. */
export function testRedirectPath(path: string, signal?: AbortSignal): Promise<RedirectTestResult> {
  return api.get<RedirectTestResult>(`${REDIRECTS_PATH}/test`, { signal, query: { path } }).then((r) => r.data)
}

/** CSV of every redirect matching the search / source filter (the X1 list export: same request plus `export=csv`). */
export function downloadRedirectsCsv(filters: { search?: string; source?: RedirectSource }, signal?: AbortSignal): Promise<DownloadedFile> {
  return downloadFile(REDIRECTS_PATH, { query: { ...filters, export: 'csv' }, signal, fallbackFilename: 'redirects.csv' })
}

/* Paths, as the server stores them (it normalizes again; this is the preview and the early check). */

const FULL_URL = /^https?:\/\//i

export const isFullUrl = (value: string) => FULL_URL.test(value.trim())

/**
 * An address as a store path: a full address of any host keeps its path and query; a leading
 * "/" is added; doubled slashes are merged; a trailing "/" (other than the home page) is dropped.
 */
export function normalizePath(value: string): string {
  let text = value.trim()
  if (text === '') return ''
  if (isFullUrl(text)) {
    try {
      const url = new URL(text)
      text = `${url.pathname}${url.search}`
    } catch {
      return text
    }
  }
  text = text.split('#', 1)[0] ?? ''
  const [path = '', query] = text.split('?', 2) as [string, string | undefined]
  let clean = `/${path}`.replace(/\/{2,}/g, '/')
  if (clean.length > 1) clean = clean.replace(/\/+$/, '')
  return query ? `${clean}?${query}` : clean
}

/** Store areas a redirect can never take over. */
const PROTECTED = /^\/(admin|api|sanctum|storage|build)(\/|$|\?)/i

/** What is wrong with the old address (null when fine). */
export function fromPathProblem(value: string): string | null {
  const raw = value.trim()
  if (raw === '') return 'Enter the old address, e.g. /p/eid-2025.'
  if (/\s/.test(raw)) return 'An address cannot contain spaces.'
  const path = normalizePath(raw)
  if (path.length > REDIRECT_LIMITS.path) return `Keep the address under ${REDIRECT_LIMITS.path} characters.`
  if (path === '/') return 'Your home page cannot be sent elsewhere.'
  if (PROTECTED.test(path)) return 'This address belongs to the system and cannot be redirected.'
  return null
}

/** What is wrong with the new address (null when fine); `from` catches a redirect to itself. */
export function toPathProblem(value: string, from = ''): string | null {
  const raw = value.trim()
  if (raw === '') return 'Enter where shoppers should go, e.g. /p/eid-2026.'
  if (/\s/.test(raw)) return 'An address cannot contain spaces.'
  if (raw.length > REDIRECT_LIMITS.path) return `Keep the address under ${REDIRECT_LIMITS.path} characters.`
  if (isFullUrl(raw)) {
    try {
      new URL(raw)
    } catch {
      return 'This web address is not complete.'
    }
    return null
  }
  if (!raw.startsWith('/') || raw.startsWith('//')) return 'Start with “/” for a page of your store, or with https:// for another site.'
  if (from.trim() !== '' && normalizePath(raw) === normalizePath(from)) return 'The new address is the same as the old one.'
  return null
}

export const TYPE_LABEL: Record<RedirectType, string> = { 301: 'Moved for good (301)', 302: 'Moved for now (302)' }
export const TYPE_HINT: Record<RedirectType, string> = {
  301: 'Use this in most cases: Google moves the old address’s place in search to the new one.',
  302: 'For a short while only, e.g. a sale page that comes back. Google keeps the old address.',
}
export const SOURCE_LABEL: Record<RedirectSource, string> = { auto: 'Automatic', manual: 'Added by you' }
