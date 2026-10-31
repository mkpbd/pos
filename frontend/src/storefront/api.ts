import { createContext, useContext } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { api, ApiError } from '@/lib/api/client'
import { storeApi } from './http'
import type { ContactInput, StorefrontBootstrap, StorefrontHomepage, StorePage } from './types'

export const BOOTSTRAP_ELEMENT_ID = 'storefront-bootstrap'

export const storefrontKeys = {
  bootstrap: ['store', 'bootstrap'] as const,
  homepage: (preview: boolean) => ['store', 'homepage', { preview }] as const,
  page: (slug: string) => ['store', 'pages', slug] as const,
}

/**
 * The payload Laravel writes into the page in production (ADR-008), so the first paint
 * needs no request. Absent in development (Vite serves the page) or if unparsable.
 */
export function readInlineBootstrap(doc: Document = document): StorefrontBootstrap | undefined {
  const text = doc.getElementById(BOOTSTRAP_ELEMENT_ID)?.textContent
  if (!text) return undefined
  try {
    return JSON.parse(text) as StorefrontBootstrap
  } catch {
    return undefined
  }
}

export async function fetchBootstrap(signal?: AbortSignal): Promise<StorefrontBootstrap> {
  return (await api.get<StorefrontBootstrap>('/store/bootstrap', { signal })).data
}

export function useBootstrapQuery() {
  return useQuery({
    queryKey: storefrontKeys.bootstrap,
    queryFn: ({ signal }) => fetchBootstrap(signal),
    initialData: readInlineBootstrap,
    staleTime: 5 * 60_000,
  })
}

/** The loaded bootstrap, provided by the storefront layout to everything below it. */
export const BootstrapContext = createContext<StorefrontBootstrap | null>(null)

export function useStorefront(): StorefrontBootstrap {
  const value = useContext(BootstrapContext)
  if (!value) throw new Error('useStorefront must be used inside the storefront layout')
  return value
}

/** The homepage sections. `preview` asks for hidden and scheduled sections too (staff only; ignored otherwise). */
export function useHomepageQuery(preview: boolean) {
  return useQuery({
    queryKey: storefrontKeys.homepage(preview),
    queryFn: ({ signal }) => api.get<StorefrontHomepage>('/store/homepage', { signal, query: preview ? { preview: 1 } : undefined }).then((r) => r.data),
    staleTime: preview ? 0 : 60_000,
  })
}

export function useStorePageQuery(slug: string) {
  return useQuery({
    queryKey: storefrontKeys.page(slug),
    queryFn: ({ signal }) => api.get<StorePage>(`/store/pages/${encodeURIComponent(slug)}`, { signal }).then((r) => r.data),
    staleTime: 60_000,
    retry: (count, error) => !(error instanceof ApiError && error.status === 404) && count < 2,
  })
}

type Message = { message: string }

export function useContactMutation() {
  return useMutation({ mutationFn: (input: ContactInput) => storeApi.post<Message>('/store/contact', input).then((r) => r.data) })
}

export function useNewsletterMutation() {
  return useMutation({ mutationFn: (email: string) => storeApi.post<Message>('/store/newsletter', { email }).then((r) => r.data) })
}

export function useNewsletterTokenMutation(action: 'confirm' | 'unsubscribe') {
  return useMutation({ mutationFn: (token: string) => storeApi.post<Message>(`/store/newsletter/${action}`, { token }).then((r) => r.data) })
}
