import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, toPaginated } from '@/lib/api/client'
import { onlineCatalogKeys } from '@/features/online-catalog/api'

export type ProductType = 'standard' | 'service'

export type ProductVariant = {
  id: string
  sku: string
  name: string | null
  option_values: Record<string, string>
  /** Absent for users without the products.view_cost permission. */
  purchase_price?: string
  selling_price: string
  wholesale_price: string | null
  reorder_level: string
  barcodes: string[]
  is_active: boolean
}

export type ProductOption = { name: string; values: string[] }

export type Product = {
  id: string
  name: string
  description: string | null
  type: ProductType
  category: { id: string; name: string } | null
  brand: { id: string; name: string } | null
  unit: { id: string; name: string; code: string; allow_decimal: boolean } | null
  tax_rate: { id: string; name: string; rate: string } | null
  track_stock: boolean
  track_batches: boolean
  track_serials: boolean
  max_discount_percent: string | null
  options: ProductOption[] | null
  is_active: boolean
  archived_at: string | null
  variants: ProductVariant[]
  images: { id: string; url: string; original_name: string }[]
}

export type ProductInput = {
  name: string
  description: string | null
  type: ProductType
  category_id: string | null
  brand_id: string | null
  unit_id: string
  tax_rate_id: string | null
  track_stock: boolean
  track_batches: boolean
  track_serials: boolean
  max_discount_percent: string | null
  is_active: boolean
  options: ProductOption[] | null
  variants: {
    id?: string
    sku: string | null
    name: string | null
    option_values: Record<string, string>
    purchase_price: string
    selling_price: string
    wholesale_price: string | null
    reorder_level: string
    barcodes: string[]
    is_active: boolean
  }[]
}

export type ProductListParams = {
  page: number
  search?: string
  category_id?: string
  type?: ProductType
  is_active?: boolean
  archived?: boolean
}

export const productKeys = {
  all: ['products'] as const,
  list: (params: ProductListParams) => ['products', 'list', params] as const,
  detail: (id: string) => ['products', 'detail', id] as const,
}

export function useProductsQuery(params: ProductListParams) {
  return useQuery({
    queryKey: productKeys.list(params),
    queryFn: ({ signal }) =>
      api
        .get<Product[]>('/products', {
          signal,
          query: {
            ...params,
            is_active: params.is_active === undefined ? undefined : Number(params.is_active),
            archived: params.archived ? 1 : undefined,
          },
        })
        .then(toPaginated),
    placeholderData: (previous) => previous,
  })
}

export function useProductQuery(id: string | undefined) {
  return useQuery({
    queryKey: productKeys.detail(id ?? ''),
    queryFn: ({ signal }) => api.get<Product>(`/products/${id}`, { signal }).then((r) => r.data),
    enabled: !!id,
  })
}

function useProductCache() {
  const queryClient = useQueryClient()
  return (product?: Product) => {
    if (product) {
      queryClient.setQueryData(productKeys.detail(product.id), product)
      // The web listing shows the product's variants, prices and images.
      void queryClient.invalidateQueries({ queryKey: onlineCatalogKeys.product(product.id) })
    }
    void queryClient.invalidateQueries({ queryKey: ['products', 'list'] })
  }
}

export function useSaveProductMutation() {
  const update = useProductCache()

  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: ProductInput }) =>
      (id ? api.put<Product>(`/products/${id}`, input) : api.post<Product>('/products', input)).then((r) => r.data),
    onSuccess: (product) => update(product),
  })
}

export function useArchiveProductMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => api.delete(`/products/${id}`),
    onSuccess: (_, id) => {
      queryClient.removeQueries({ queryKey: productKeys.detail(id) })
      void queryClient.invalidateQueries({ queryKey: ['products', 'list'] })
    },
  })
}

export function useRestoreProductMutation() {
  const update = useProductCache()

  return useMutation({
    mutationFn: (id: string) => api.post<Product>(`/products/${id}/restore`).then((r) => r.data),
    onSuccess: (product) => update(product),
  })
}

export function useUploadProductImageMutation(productId: string) {
  const update = useProductCache()

  return useMutation({
    mutationFn: (file: File) => {
      const body = new FormData()
      body.append('image', file)
      return api.post<Product>(`/products/${productId}/images`, body).then((r) => r.data)
    },
    onSuccess: (product) => update(product),
  })
}

export function useRemoveProductImageMutation(productId: string) {
  const update = useProductCache()

  return useMutation({
    mutationFn: (imageId: string) => api.delete<Product>(`/products/${productId}/images/${imageId}`).then((r) => r.data),
    onSuccess: (product) => update(product),
  })
}

/**
 * Names and first images of products by id (one cached GET /products/{id} each), for showing
 * references such as hand-picked homepage products. Missing products resolve to nothing.
 */
export function useProductNames(ids: string[]): Map<string, { name: string; image_url: string | null }> {
  const results = useQueries({
    queries: ids.map((id) => ({
      queryKey: productKeys.detail(id),
      queryFn: ({ signal }: { signal: AbortSignal }) => api.get<Product>(`/products/${id}`, { signal }).then((r) => r.data),
      staleTime: 5 * 60_000,
      retry: false,
    })),
  })
  const map = new Map<string, { name: string; image_url: string | null }>()
  results.forEach((r) => {
    if (r.data) map.set(r.data.id, { name: r.data.name, image_url: r.data.images[0]?.url ?? null })
  })
  return map
}
