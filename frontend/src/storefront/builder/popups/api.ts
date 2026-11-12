import { useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router'
import { storeApi } from '../../http'
import { useLocale } from '../../i18n/locale'
import { localized } from '../../store-keys'
import { isUuid, normalizeStorePopupSettings } from '../validate'
import type { StorePopupEntry, StorePopupsResponse } from '../types'

/** `?preview=draft&popup=<id>` on the store URL: staff see that popup's draft at once (the API ignores it for anyone else). */
export function usePopupPreviewId(): string | null {
  const [params] = useSearchParams()
  const id = params.get('popup')
  return params.get('preview') === 'draft' && isUuid(id) ? id : null
}

export const popupKeys = {
  list: (previewId: string | null) => ['store', 'builder', 'popups', { preview: previewId }] as const,
}

/** Whatever arrives is checked: entries without an id or a sections list are dropped; settings get every key. */
export function readPopups(value: unknown): StorePopupsResponse {
  const v = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
  const popups = (Array.isArray(v.popups) ? v.popups : []).flatMap((entry): StorePopupEntry[] => {
    if (typeof entry !== 'object' || entry === null) return []
    const e = entry as Record<string, unknown>
    const payload = typeof e.payload === 'object' && e.payload !== null ? (e.payload as Record<string, unknown>) : null
    if (typeof e.id !== 'string' || !e.id || !payload || !Array.isArray(payload.sections)) return []
    return [
      {
        id: e.id,
        version: typeof e.version === 'number' ? e.version : null,
        settings: normalizeStorePopupSettings(e.settings),
        payload: {
          sections: payload.sections as StorePopupEntry['payload']['sections'],
          media: (typeof payload.media === 'object' && payload.media !== null && !Array.isArray(payload.media) ? payload.media : {}) as StorePopupEntry['payload']['media'],
          data: (typeof payload.data === 'object' && payload.data !== null && !Array.isArray(payload.data) ? payload.data : {}) as StorePopupEntry['payload']['data'],
        },
      },
    ]
  })
  const neverOn = Array.isArray(v.never_on) ? v.never_on.filter((p): p is string => typeof p === 'string' && p.startsWith('/')) : []
  return { popups, never_on: neverOn }
}

/**
 * The live popups (GET /store/builder/popups, in the current language), or one popup's draft for
 * staff. `enabled` = false until the page has painted, so popups never hold up the page.
 */
export function usePopupsQuery(enabled: boolean) {
  const { locale } = useLocale()
  const previewId = usePopupPreviewId()
  return useQuery({
    queryKey: localized(popupKeys.list(previewId), locale),
    queryFn: ({ signal }) =>
      storeApi.get<unknown>('/store/builder/popups', { signal, query: previewId ? { preview: 'draft', popup: previewId } : undefined }).then((r) => readPopups(r.data)),
    enabled,
    staleTime: previewId ? 0 : 60_000,
    // Popups are extras: a failed load just means none this time.
    retry: false,
  })
}
