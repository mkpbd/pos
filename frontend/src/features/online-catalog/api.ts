import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, toPaginated } from '@/lib/api/client'
import type { ProductOption } from '@/features/products/api'
import { storefrontKeys, type ThemeResponse } from '@/features/storefront/api'
import type { TranslationsInput, TranslationsMap } from '@/features/translations/translations'

/** Web state of a listing, computed by the server from the publish switch and schedule. */
export type ListingState = 'draft' | 'scheduled' | 'live' | 'expired'

export type Specification = { label: string; value: string }

/** P1b: colour family of a custom badge (the store draws each in a theme colour that keeps the text readable). */
export const BADGE_TONES = ['sale', 'new', 'info', 'dark'] as const
export type BadgeTone = (typeof BADGE_TONES)[number]

/** P1b: a custom badge on the product's photos and cards; Bangla text in `translations.bn.text`. */
export type ListingBadge = { text: string; tone: BadgeTone; translations?: TranslationsMap }
export type ListingBadgeInput = { text: string; tone: BadgeTone; translations: TranslationsInput }

export type ListingProduct = {
  id: string
  name: string
  category_id: string | null
  brand_id: string | null
  is_active: boolean
  options: ProductOption[] | null
  images: { id: string; url: string }[]
  variants: { id: string; sku: string; name: string | null; option_values: Record<string, string>; selling_price: string; is_active: boolean }[]
}

export type ProductListing = {
  /** False until the first save; the other fields are then the suggested defaults. */
  exists: boolean
  slug: string
  is_published: boolean
  published_at: string | null
  unpublished_at: string | null
  is_featured: boolean
  is_new_until: string | null
  short_description: string | null
  description_html: string | null
  specifications: Specification[]
  seo_title: string | null
  seo_description: string | null
  sort_weight: number
  state: ListingState
  /** Bangla texts (E12b): name, short_description, description_html, seo_title, seo_description. */
  translations?: TranslationsMap
  /** P1a: the product's own size guide (null = the category's guide). */
  size_guide_id?: string | null
  /** P1a: the guide the product gets from its category (nearest ancestor), if any. */
  inherited_size_guide?: { id: string; name: string } | null
  /** P1b: a YouTube or Vimeo link shown as the last gallery slide (absent = not offered by the API). */
  video_url?: string | null
  /** P1b: up to two custom badges (absent = not offered by the API). */
  badges?: ListingBadge[]
}

export type VariantListing = { variant_id: string; compare_at_price: string | null; image_id: string | null }

export type RelatedProduct = { id: string; name: string; image_url: string | null; sku: string | null }

export type ProductListingResponse = {
  product: ListingProduct
  listing: ProductListing
  variants: VariantListing[]
  related: { related: RelatedProduct[]; frequently_bought: RelatedProduct[] }
  /** Storefront path, e.g. "/product/mango-juice". */
  url: string
}

export type ProductListingInput = {
  slug?: string
  is_published: boolean
  published_at: string | null
  unpublished_at: string | null
  is_featured: boolean
  is_new_until: string | null
  short_description: string | null
  description_html: string | null
  specifications: Specification[]
  seo_title: string | null
  seo_description: string | null
  sort_weight: number
  variants: VariantListing[]
  translations?: TranslationsInput
  /** P1a: null = use the category's size guide. */
  size_guide_id?: string | null
  /** P1b: null removes the video. */
  video_url?: string | null
  /** P1b: replaces the list (≤ 2). */
  badges?: ListingBadgeInput[]
}

export type RelatedInput = { related: string[]; frequently_bought: string[] }

/** One catalog category in tree order with its web listing (null = never listed). */
export type WebCategoryRow = {
  id: string
  name: string
  parent_id: string | null
  depth: number
  is_active: boolean
  listing: null | { slug: string; is_visible: boolean }
}

export type CategoryListing = {
  exists: boolean
  slug: string
  is_visible: boolean
  image_media_id: string | null
  banner_media_id: string | null
  description_html: string | null
  seo_title: string | null
  seo_description: string | null
  /** Bangla texts (E12b): name, description_html, seo_title, seo_description. */
  translations?: TranslationsMap
}

export type CategoryListingResponse = {
  category: { id: string; name: string; parent_id: string | null; is_active: boolean }
  listing: CategoryListing
  url: string
}

export type CategoryListingInput = Omit<CategoryListing, 'exists' | 'slug' | 'translations'> & { slug?: string; translations?: TranslationsInput }

export type WebBrandRow = { id: string; name: string; is_active: boolean; listing: null | { slug: string; is_visible: boolean } }

export type BrandListing = {
  exists: boolean
  slug: string
  is_visible: boolean
  logo_media_id: string | null
  description: string | null
  seo_title: string | null
  seo_description: string | null
  /** Bangla texts (E12b): name, description, seo_title, seo_description. */
  translations?: TranslationsMap
}

export type BrandListingResponse = {
  brand: { id: string; name: string; is_active: boolean }
  listing: BrandListing
  url: string
}

export type BrandListingInput = Omit<BrandListing, 'exists' | 'slug' | 'translations'> & { slug?: string; translations?: TranslationsInput }

/** A product as found by the admin product search (GET /products?search=). */
export type ProductSearchHit = { id: string; name: string; variants: { sku: string }[]; images: { url: string }[]; is_active: boolean }

export const onlineCatalogKeys = {
  all: ['online-catalog'] as const,
  product: (id: string) => ['online-catalog', 'products', id] as const,
  categories: ['online-catalog', 'categories'] as const,
  category: (id: string) => ['online-catalog', 'categories', id] as const,
  brands: ['online-catalog', 'brands'] as const,
  brand: (id: string) => ['online-catalog', 'brands', id] as const,
  productSearch: (term: string) => ['online-catalog', 'product-search', term] as const,
}

export function useProductListingQuery(productId: string) {
  return useQuery({
    queryKey: onlineCatalogKeys.product(productId),
    queryFn: ({ signal }) => api.get<ProductListingResponse>(`/online-catalog/products/${productId}`, { signal }).then((r) => r.data),
  })
}

/** Saves the listing, then the related lists; resolves with the listing as stored. */
export function useSaveProductListingMutation(productId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ listing, related }: { listing: ProductListingInput; related: RelatedInput }) => {
      const saved = (await api.put<ProductListingResponse>(`/online-catalog/products/${productId}`, listing)).data
      await api.put(`/online-catalog/products/${productId}/related`, related)
      return saved
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: onlineCatalogKeys.product(productId) }),
  })
}

export function useWebCategoriesQuery() {
  return useQuery({
    queryKey: onlineCatalogKeys.categories,
    queryFn: ({ signal }) => api.get<WebCategoryRow[]>('/online-catalog/categories', { signal }).then((r) => r.data),
  })
}

export function useCategoryListingQuery(id: string | null) {
  return useQuery({
    queryKey: onlineCatalogKeys.category(id ?? ''),
    queryFn: ({ signal }) => api.get<CategoryListingResponse>(`/online-catalog/categories/${id}`, { signal }).then((r) => r.data),
    enabled: id !== null,
  })
}

export function useSaveCategoryListingMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: CategoryListingInput }) =>
      api.put<CategoryListingResponse>(`/online-catalog/categories/${id}`, input).then((r) => r.data),
    onSuccess: (saved) => {
      queryClient.setQueryData(onlineCatalogKeys.category(saved.category.id), saved)
      return queryClient.invalidateQueries({ queryKey: onlineCatalogKeys.categories, exact: true })
    },
  })
}

export function useWebBrandsQuery() {
  return useQuery({
    queryKey: onlineCatalogKeys.brands,
    queryFn: ({ signal }) => api.get<WebBrandRow[]>('/online-catalog/brands', { signal }).then((r) => r.data),
  })
}

export function useBrandListingQuery(id: string | null) {
  return useQuery({
    queryKey: onlineCatalogKeys.brand(id ?? ''),
    queryFn: ({ signal }) => api.get<BrandListingResponse>(`/online-catalog/brands/${id}`, { signal }).then((r) => r.data),
    enabled: id !== null,
  })
}

export function useSaveBrandListingMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: BrandListingInput }) =>
      api.put<BrandListingResponse>(`/online-catalog/brands/${id}`, input).then((r) => r.data),
    onSuccess: (saved) => {
      queryClient.setQueryData(onlineCatalogKeys.brand(saved.brand.id), saved)
      return queryClient.invalidateQueries({ queryKey: onlineCatalogKeys.brands, exact: true })
    },
  })
}

/**
 * P1b: the live theme's colours for the badge preview (GET /storefront/theme, storefront.view;
 * shares the Theme page's cache). `enabled` false (no permission) = the preview's default colours.
 */
export function useStoreThemeColorsQuery(enabled: boolean) {
  return useQuery({
    queryKey: storefrontKeys.theme,
    queryFn: ({ signal }) => api.get<ThemeResponse>('/storefront/theme', { signal }).then((r) => r.data),
    select: (theme) => theme.settings.colors,
    enabled,
    staleTime: 5 * 60_000,
  })
}

/** Products matching a search term (first page), only while `enabled`. */
export function useProductSearchQuery(term: string, enabled: boolean) {
  return useQuery({
    queryKey: onlineCatalogKeys.productSearch(term),
    queryFn: ({ signal }) => api.get<ProductSearchHit[]>('/products', { signal, query: { page: 1, search: term || undefined } }).then(toPaginated),
    enabled,
    staleTime: 30_000,
    placeholderData: (previous) => previous,
  })
}
