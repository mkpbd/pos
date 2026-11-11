import { useQuery } from '@tanstack/react-query'
import { ApiError } from '@/lib/api/client'
import { storeApi } from '../http'

/** One demo store as GET /api/v1/demo-stores lists it: public store data only, never logins. */
export type DemoStore = {
  host: string
  name: string
  /** Theme preset key (`vegan`, `handmade`, `classic`, …). */
  preset: string
  /** The store's announcement or footer "about" text, at most 140 characters. */
  tagline: string | null
  colors: { primary: string; accent: string; canvas: string }
  /** Theme heading font key (`baloo`, `playfair`, `jost`, …). */
  heading_font: string
  /** The first hero slide or banner image; null when the store has none. */
  image_url: string | null
  product_count: number
  /** At most six. */
  category_names: string[]
}

export const demoStoreKeys = {
  all: ['demo-stores'] as const,
}

/**
 * The demo stores this server offers. Not a /store/* request: it needs no store on the host,
 * and it answers 404 when the gallery is turned off (`storefront.demo_gallery`).
 */
export function useDemoStoresQuery() {
  return useQuery({
    queryKey: demoStoreKeys.all,
    queryFn: ({ signal }) => storeApi.get<DemoStore[]>('/demo-stores', { signal }).then((r) => (Array.isArray(r.data) ? r.data : [])),
    staleTime: 60_000,
  })
}

/** The gallery is turned off on this server (or the endpoint does not exist): a 404. */
export function isGalleryDisabled(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404
}
