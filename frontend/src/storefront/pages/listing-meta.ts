import { isNotFound, type useBrandQuery, type useCategoryQuery } from '../catalog/api'
import { DEFAULT_PER_PAGE, DEFAULT_SORT, hasActiveFilters, type ListingScope, type ListingState } from '../catalog/listing-params'
import { useLocale } from '../i18n/locale'
import { useDocumentMeta } from '../use-document-meta'

/** Filters, a sort, page size or view other than the defaults: a variant of the listing, not a page of its own. */
function isRearranged(state: ListingState): boolean {
  return Boolean(state.q) || hasActiveFilters(state) || state.sort !== DEFAULT_SORT || state.perPage !== DEFAULT_PER_PAGE || state.view !== 'grid'
}

/** The first 160 characters of an HTML description as plain text. */
function plainText(html: string | null | undefined): string | null {
  if (!html) return null
  const text = (new DOMParser().parseFromString(html, 'text/html').body.textContent ?? '').replace(/\s+/g, ' ').trim()
  return text ? (text.length > 160 ? `${text.slice(0, 157).trimEnd()}…` : text) : null
}

/**
 * The listing page's heading, 404 and document meta (title, description, image, canonical,
 * noindex) — the same for the standard page and a B14 store page template.
 */
export function useListingMeta(
  scope: ListingScope,
  state: ListingState,
  category: ReturnType<typeof useCategoryQuery>,
  brand: ReturnType<typeof useBrandQuery>,
  listingError: unknown,
): { heading: string; notFound: boolean } {
  const { t } = useLocale()
  const heading =
    scope.kind === 'shop'
      ? t('catalog.listing.shop')
      : scope.kind === 'search'
        ? state.q
          ? t('catalog.listing.searchResults', { q: state.q })
          : t('catalog.listing.search')
        : scope.kind === 'category'
          ? (category.data?.name ?? '')
          : scope.kind === 'brand'
            ? (brand.data?.name ?? '')
            : ''
  const seoTitle = scope.kind === 'category' ? category.data?.seo.title : scope.kind === 'brand' ? brand.data?.seo.title : null
  const notFound = (scope.kind === 'category' && (isNotFound(category.error) || isNotFound(listingError))) || (scope.kind === 'brand' && (isNotFound(brand.error) || isNotFound(listingError)))

  // Canonical: the unfiltered listing (plus ?page=N); filtered, sorted or re-arranged views and search results are noindex.
  useDocumentMeta(
    heading && !notFound
      ? {
          title: seoTitle || heading,
          description:
            scope.kind === 'category'
              ? (category.data?.seo.description ?? plainText(category.data?.description_html))
              : scope.kind === 'brand'
                ? (brand.data?.seo.description ?? brand.data?.description)
                : null,
          image: scope.kind === 'category' ? (category.data?.banner ?? category.data?.image)?.url : scope.kind === 'brand' ? brand.data?.logo?.url : null,
          noindex: scope.kind === 'search' || isRearranged(state),
        }
      : null,
  )
  return { heading, notFound }
}
