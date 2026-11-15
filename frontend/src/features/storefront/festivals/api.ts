import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { builderAdminKeys } from '@/features/store-builder/api'
import { api } from '@/lib/api/client'

/*
 * B17 festival calendar and one-click setup (GET /storefront/festivals, POST
 * /storefront/festivals/{key}/setup). Setup only writes drafts; "Review & publish" sends the
 * returned `publish_ids` to the existing POST /storefront/builder/publish-all.
 */

export const FESTIVAL_KEYS = [
  'eid-ul-fitr',
  'eid-ul-adha',
  'ramadan',
  'durga-puja',
  'pohela-boishakh',
  'ekushey',
  'independence-day',
  'victory-day',
  'winter-sale',
  'eleven-eleven',
] as const

export type FestivalKind = 'fixed' | 'lunar' | 'season'
export type FestivalSetupState = 'drafts_ready' | 'live_on_dates' | 'ended'
export type FestivalDocumentRole = 'landing' | 'home' | 'bar'
export type FestivalDocumentStatus = 'unpublished' | 'changed' | 'published'

/** A draft the setup wrote (landing page, home page with the hero, announcement bar popup). */
export type FestivalDocument = {
  id: string
  kind: string
  key: string
  title: string
  role: FestivalDocumentRole
  status: FestivalDocumentStatus
  preview_url?: string | null
}

export type FestivalSetup = {
  year: number
  starts_at: string
  ends_at: string
  state: FestivalSetupState
  landing_slug: string | null
  documents: FestivalDocument[]
}

export type Festival = {
  key: string
  name: string
  name_bn: string
  kind: FestivalKind
  /** False for a tribute day (Ekushey): the templates carry no sale words. */
  sale_wording: boolean
  /** The next occurrence in the store's timezone (dates `YYYY-MM-DD`). */
  next: { year: number; starts_on: string; ends_on: string; expected: boolean; note: string | null; note_bn: string | null }
  /** Prefilled campaign window (ISO instants). */
  suggested: { starts_at: string; ends_at: string }
  setup: FestivalSetup | null
}

export type FestivalSetupInput = {
  year: number
  starts_at: string
  ends_at: string
  include: { landing: boolean; home_hero: boolean; bar: boolean }
  discount_id?: string | null
  landing_slug?: string
}

export type FestivalSetupResult = { festival: Festival | null; documents: FestivalDocument[]; publish_ids: string[] }

export const festivalKeys = {
  all: ['storefront', 'festivals'] as const,
}

export function useFestivalsQuery() {
  return useQuery({
    queryKey: festivalKeys.all,
    queryFn: ({ signal }) => api.get<Festival[]>('/storefront/festivals', { signal }).then((r) => (Array.isArray(r.data) ? r.data : [])),
  })
}

export function setupFestival(key: string, input: FestivalSetupInput): Promise<FestivalSetupResult> {
  return api.post<Partial<FestivalSetupResult>>(`/storefront/festivals/${encodeURIComponent(key)}/setup`, input).then((r) => {
    const documents = r.data?.documents ?? []
    return { festival: r.data?.festival ?? null, documents, publish_ids: r.data?.publish_ids ?? documents.map((d) => d.id) }
  })
}

/** Writes the drafts (never publishes); the calendar and the builder's documents list refresh. */
export function useFestivalSetupMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ key, input }: { key: string; input: FestivalSetupInput }) => setupFestival(key, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: festivalKeys.all })
      void queryClient.invalidateQueries({ queryKey: builderAdminKeys.documents })
    },
  })
}
