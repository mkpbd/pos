import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, toPaginated } from '@/lib/api/client'
import { inventoryKeys, type AdjustmentReason } from '@/features/inventory/api'
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
  /** Online compare-at ("was") price (P1a variant grid). */
  compare_at_price?: string | null
  /** Stock on hand (P1a); null for services and products without stock tracking. */
  stock?: VariantStock | null
  /** Shoppers waiting for a back-in-stock e-mail (P1a §3). */
  back_in_stock_open?: number
}

export type VariantStock = { total: string; by_store: { store_id: string; branch_id: string; quantity: string }[] }

/** How a product option is shown to shoppers (P1a §1). */
export type OptionStyle = 'color' | 'image' | 'button'

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
  /** The option whose values own photos ("Colour"), or null (P1a §1). */
  photo_option?: string | null
  /** Swatch style per option name; missing = from the attribute's display. */
  option_styles?: Record<string, OptionStyle>
  /** Photo ids per value of the photo option, in order. */
  option_images?: Record<string, string[]>
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

/** PUT /products/{id}/variants (P1a §2): the whole grid, matched by id; idempotent. */
export type VariantGridInput = {
  options: ProductOption[] | null
  variants: {
    id?: string
    option_values: Record<string, string>
    sku: string | null
    barcodes: string[]
    purchase_price: string
    selling_price: string
    wholesale_price: string | null
    compare_at_price: string | null
    reorder_level: string
    is_active: boolean
    /** New variants only: put in stock through Inventory's opening stock (note "Variant grid"). */
    opening_stock?: string
  }[]
  /** Store receiving the opening stock; required when any variant has some. */
  stock_store_id?: string
}

export type OptionImagesInput = {
  photo_option: string | null
  /** null removes an explicit style (back to the attribute's display). */
  styles: Record<string, OptionStyle | null>
  values: { value: string; image_ids: string[] }[]
}

export type BackInStockRequest = {
  id: string
  variant_id: string
  variant_label: string
  email: string
  locale: string
  created_at: string
  notified_at: string | null
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
  backInStock: (id: string, params: BackInStockParams) => ['products', 'back-in-stock', id, params] as const,
}

/** Query string of GET /products — shared by the list and its export. */
export function productListQuery(params: Omit<ProductListParams, 'page'> & { page?: number }) {
  return {
    ...params,
    is_active: params.is_active === undefined ? undefined : Number(params.is_active),
    archived: params.archived ? 1 : undefined,
  }
}

export function useProductsQuery(params: ProductListParams) {
  return useQuery({
    queryKey: productKeys.list(params),
    queryFn: ({ signal }) => api.get<Product[]>('/products', { signal, query: productListQuery(params) }).then(toPaginated),
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

export function useSaveVariantGridMutation(productId: string) {
  const update = useProductCache()

  return useMutation({
    mutationFn: (input: VariantGridInput) => api.put<Product>(`/products/${productId}/variants`, input).then((r) => r.data),
    onSuccess: (product) => update(product),
  })
}

/** Photos by colour and swatch styles (P1a §1). */
export function useSaveOptionImagesMutation(productId: string) {
  const update = useProductCache()

  return useMutation({
    mutationFn: (input: OptionImagesInput) => api.put<Product>(`/products/${productId}/option-images`, input).then((r) => r.data),
    onSuccess: (product) => update(product),
  })
}

/**
 * Stock changes from the variant grid go through Inventory's adjustment use case (audited,
 * in a transaction); the product is refetched for the new stock figures.
 */
export function useGridStockAdjustmentMutation(productId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: { store_id: string; reason: AdjustmentReason; lines: { variant_id: string; quantity: string }[] }) =>
      api.post<{ id: string; number: string }>('/inventory/adjustments', { ...input, note: 'Variant grid' }).then((r) => r.data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: productKeys.detail(productId) })
      void queryClient.invalidateQueries({ queryKey: inventoryKeys.all })
    },
  })
}

export type BackInStockParams = { page: number; status?: 'open' | 'notified' }

export function useBackInStockQuery(productId: string, params: BackInStockParams) {
  return useQuery({
    queryKey: productKeys.backInStock(productId, params),
    queryFn: ({ signal }) => api.get<BackInStockRequest[]>(`/products/${productId}/back-in-stock-requests`, { signal, query: params }).then(toPaginated),
    placeholderData: (previous) => previous,
  })
}
