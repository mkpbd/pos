import { useMemo } from 'react'
import { useLocation } from 'react-router'
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '@/lib/api/client'
import type { Section } from '@/storefront/builder/types'
import { builderAdminKeys, fetchDocument, type DocumentDetail, type DocumentSummary, type GlobalUsage } from './api'
import { sectionNodes, isGlobalRef, type GlobalContext, type GlobalEntry } from './global-sections'

/*
 * B9 global sections, admin API: GET /storefront/builder/globals (with usage), create (POST
 * /documents, kind global, empty or from a section of a draft), delete (409 GLOBAL_IN_USE while a
 * page shows it) and the drafts of the globals a document refers to (the canvas draws them).
 */

export type GlobalSummary = DocumentSummary & {
  context: GlobalContext
  usage_count: number
  used_in: GlobalUsage[]
}

export const GLOBAL_IN_USE = 'GLOBAL_IN_USE'

export const globalKeys = {
  list: ['store-builder', 'globals'] as const,
  /** A global's draft as a page editor draws it (not the editor's own document query). */
  content: (id: string) => ['store-builder', 'globals', 'content', id] as const,
}

export function fetchGlobals(signal?: AbortSignal) {
  return api.get<GlobalSummary[]>('/storefront/builder/globals', { signal }).then((r) => r.data ?? [])
}

export function useGlobalsQuery(enabled = true) {
  return useQuery({ queryKey: globalKeys.list, queryFn: ({ signal }) => fetchGlobals(signal), enabled, staleTime: 30_000 })
}

export type CreateGlobalInput = { title: string; context: GlobalContext; section?: Section }

export function createGlobal(input: CreateGlobalInput) {
  const body = input.section ? { kind: 'global', title: input.title, context: input.context, from: 'section', section: input.section } : { kind: 'global', title: input.title, context: input.context, from: 'blank' }
  return api.post<DocumentDetail>('/storefront/builder/documents', body).then((r) => r.data)
}

export function useCreateGlobalMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: createGlobal,
    onSuccess: (created) => {
      queryClient.setQueryData(builderAdminKeys.document(created.id), created)
      void queryClient.invalidateQueries({ queryKey: globalKeys.list })
    },
  })
}

/** The pages listed by a 409 GLOBAL_IN_USE (empty for other errors). */
export function usageOfError(error: unknown): GlobalUsage[] {
  if (!(error instanceof ApiError) || error.code !== GLOBAL_IN_USE) return []
  const details = error.details as { used_in?: unknown } | undefined
  return Array.isArray(details?.used_in) ? (details.used_in as GlobalUsage[]) : []
}

export function useDeleteGlobalMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.delete(`/storefront/builder/documents/${encodeURIComponent(id)}`),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: globalKeys.list }),
  })
}

/** The first section of a global's content (a global holds exactly one). */
export function globalSection(detail: Pick<DocumentDetail, 'content'>): Section | null {
  const first = sectionNodes(detail.content)[0]
  return first && !isGlobalRef(first) ? first : null
}

export function entryFromDetail(detail: DocumentDetail): GlobalEntry {
  const section = globalSection(detail)
  return { id: detail.id, title: detail.title, context: (detail.context ?? 'page') as GlobalContext, section, state: section ? 'ready' : 'missing' }
}

/**
 * The drafts of the globals `ids` (a page's references), for the canvas: loading, ready or missing
 * (gone, another store's, or failed). Refetched when the window gets focus again (the global may
 * have been edited in another tab).
 */
export function useGlobalEntries(ids: readonly string[]): ReadonlyMap<string, GlobalEntry> {
  const results = useQueries({
    queries: ids.map((id) => ({
      queryKey: globalKeys.content(id),
      queryFn: () => fetchDocument(id),
      staleTime: 15_000,
      retry: (count: number, error: unknown) => !(error instanceof ApiError && error.status === 404) && count < 2,
    })),
  })
  const key = results.map((r) => `${r.status}:${r.dataUpdatedAt}`).join('|')
  return useMemo(() => {
    const map = new Map<string, GlobalEntry>()
    ids.forEach((id, i) => {
      const result = results[i]
      if (result?.data) map.set(id, entryFromDetail(result.data))
      else if (result?.isError) map.set(id, { id, title: '', context: 'page', section: null, state: 'missing' })
      else map.set(id, { id, title: '', context: 'page', section: null, state: 'loading' })
    })
    return map
    // `results` is a new array each render; `key` says when anything in it changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids.join(','), key])
}

export type BackTo = { id: string; title: string }

/** Where the global was opened from (router state of "Edit global section"). */
export function useBackTo(): BackTo | null {
  const location = useLocation()
  const back = (location.state as { back?: BackTo } | null)?.back
  return back && typeof back.id === 'string' && typeof back.title === 'string' ? back : null
}
