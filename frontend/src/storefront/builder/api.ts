import { useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router'
import { ApiError } from '@/lib/api/client'
import { storeApi } from '../http'
import { useLocale } from '../i18n/locale'
import { localized } from '../store-keys'
import type { BuilderPage } from './types'

/**
 * Query keys of builder pages. Under `['store', 'builder', …]` so they never collide with the CMS
 * content pages (`['store', 'pages', slug]`).
 */
export const builderKeys = {
  all: ['store', 'builder'] as const,
  page: (key: string, draft: boolean) => ['store', 'builder', 'pages', key, { draft }] as const,
}

/** The public endpoint of a builder page: `home`, or a landing page's slug ("home" is reserved for the front page). */
export function builderPagePath(key: string): string {
  return `/store/builder/pages/${encodeURIComponent(key)}`
}

/** `?preview=draft` on the store URL: signed-in staff see the draft (the API ignores it for everyone else). */
export function useDraftPreview(): boolean {
  const [params] = useSearchParams()
  return params.get('preview') === 'draft'
}

/**
 * The render payload of a builder page (`home` or a landing slug), in the current language. The
 * published version, or the draft when the URL asks for `?preview=draft`. A 404 is final.
 */
export function usePageQuery(key: string) {
  const { locale } = useLocale()
  const draft = useDraftPreview()
  return useQuery({
    queryKey: localized(builderKeys.page(key, draft), locale),
    queryFn: ({ signal }) => storeApi.get<BuilderPage>(builderPagePath(key), { signal, query: draft ? { preview: 'draft' } : undefined }).then((r) => r.data),
    staleTime: draft ? 0 : 60_000,
    retry: (count, error) => !(error instanceof ApiError && error.status === 404) && count < 2,
  })
}
