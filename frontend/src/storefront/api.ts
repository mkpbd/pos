import { createContext, useContext } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api/client'
import type { StorefrontBootstrap } from './types'

export const BOOTSTRAP_ELEMENT_ID = 'storefront-bootstrap'

export const storefrontKeys = {
  bootstrap: ['store', 'bootstrap'] as const,
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
