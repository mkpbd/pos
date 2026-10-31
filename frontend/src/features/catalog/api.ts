import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api/client'

export type Category = {
  id: string
  parent_id: string | null
  name: string
  description: string | null
  sort_order: number
  is_active: boolean
}

export type Brand = { id: string; name: string; description: string | null; is_active: boolean }

export type Unit = {
  id: string
  name: string
  code: string
  allow_decimal: boolean
  base_unit_id: string | null
  conversion_factor: string | null
  is_active: boolean
}

export type TaxRate = { id: string; name: string; rate: string; is_active: boolean }

/** Catalog reference resources and their API paths. */
export const CATALOG_PATHS = {
  categories: '/categories',
  brands: '/brands',
  units: '/units',
  taxRates: '/tax-rates',
} as const

export type CatalogKind = keyof typeof CATALOG_PATHS

type CatalogRecord = { categories: Category; brands: Brand; units: Unit; taxRates: TaxRate }

export const catalogKeys = {
  all: ['catalog'] as const,
  list: (kind: CatalogKind) => ['catalog', kind] as const,
}

export function useCatalogList<K extends CatalogKind>(kind: K, enabled = true) {
  return useQuery({
    queryKey: catalogKeys.list(kind),
    queryFn: ({ signal }) => api.get<CatalogRecord[K][]>(CATALOG_PATHS[kind], { signal }).then((r) => r.data),
    staleTime: 5 * 60_000,
    enabled,
  })
}

export function useSaveCatalogRecord<K extends CatalogKind>(kind: K) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: Partial<CatalogRecord[K]> }) =>
      (id ? api.patch<CatalogRecord[K]>(`${CATALOG_PATHS[kind]}/${id}`, input) : api.post<CatalogRecord[K]>(CATALOG_PATHS[kind], input)).then((r) => r.data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: catalogKeys.list(kind) }),
  })
}

export function useDeleteCatalogRecord(kind: CatalogKind) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => api.delete(`${CATALOG_PATHS[kind]}/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: catalogKeys.list(kind) }),
  })
}

/** Categories as an indented, depth-first list for tables and selects. */
export function flattenCategoryTree(categories: Category[]): (Category & { depth: number; path: string })[] {
  const byParent = new Map<string | null, Category[]>()
  for (const c of categories) {
    const siblings = byParent.get(c.parent_id) ?? []
    siblings.push(c)
    byParent.set(c.parent_id, siblings)
  }

  const result: (Category & { depth: number; path: string })[] = []
  const walk = (parentId: string | null, depth: number, prefix: string) => {
    const children = (byParent.get(parentId) ?? []).sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
    for (const child of children) {
      const path = prefix ? `${prefix} › ${child.name}` : child.name
      result.push({ ...child, depth, path })
      walk(child.id, depth + 1, path)
    }
  }
  walk(null, 0, '')

  return result
}

export const ATTRIBUTE_DISPLAYS = ['button', 'swatch', 'text'] as const
export type AttributeDisplay = (typeof ATTRIBUTE_DISPLAYS)[number]

export type AttributeValue = { id: string; value: string; swatch_hex: string | null; sort_order: number }

/** A product option dictionary entry (e.g. Size, Colour) used for web filters and swatches. */
export type Attribute = {
  id: string
  name: string
  slug: string
  display: AttributeDisplay
  is_filterable: boolean
  sort_order: number
  values: AttributeValue[]
}

export type AttributeInput = {
  name: string
  slug?: string
  display: AttributeDisplay
  is_filterable: boolean
  sort_order?: number
  /** Replaces the values in this order; ids keep existing ones. */
  values: { id?: string; value: string; swatch_hex?: string | null }[]
}

export const attributeKeys = { all: ['catalog', 'attributes'] as const }

export function useAttributesQuery(enabled = true) {
  return useQuery({
    queryKey: attributeKeys.all,
    queryFn: ({ signal }) => api.get<Attribute[]>('/attributes', { signal }).then((r) => r.data),
    staleTime: 5 * 60_000,
    enabled,
  })
}

export function useSaveAttributeMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: AttributeInput }) =>
      (id ? api.patch<Attribute>(`/attributes/${id}`, input) : api.post<Attribute>('/attributes', input)).then((r) => r.data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: attributeKeys.all }),
  })
}

export function useDeleteAttributeMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => api.delete(`/attributes/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: attributeKeys.all }),
  })
}
