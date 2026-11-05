import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useParams, useSearchParams } from 'react-router'
import { SlidersHorizontalIcon, XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { cn } from '@/lib/utils'
import { isNotFound, useBrandQuery, useCategoryQuery, useProductListingQuery } from '../catalog/api'
import { Breadcrumbs } from '../catalog/breadcrumbs'
import { FilterPanel } from '../catalog/filter-panel'
import {
  clearFilters,
  DEFAULT_PER_PAGE,
  DEFAULT_SORT,
  hasActiveFilters,
  parseListingState,
  serializeListingState,
  toApiQuery,
  toggleAttribute,
  toggleValue,
  type ListingScope,
  type ListingState,
} from '../catalog/listing-params'
import { ListingToolbar, Pagination } from '../catalog/listing-toolbar'
import { ProductCard } from '../catalog/product-card'
import { HeaderSearch } from '../components/header-search'
import { MediaImage } from '../components/media-image'
import { RichText } from '../components/rich-text'
import { useLocale } from '../i18n/locale'
import { usePriceFormat } from '../money'
import type { Breadcrumb, ListingFacets, ProductListing, StoreBrand, StoreCategory } from '../types'
import { useDocumentMeta } from '../use-document-meta'
import { NotFoundPage } from './not-found-page'

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

export function ShopPage() {
  return <ListingPage scope={{ kind: 'shop' }} />
}

export function SearchPage() {
  return <ListingPage scope={{ kind: 'search' }} />
}

export function CategoryPage() {
  const { slug = '' } = useParams()
  return <ListingPage key={slug} scope={{ kind: 'category', slug }} />
}

export function BrandPage() {
  const { slug = '' } = useParams()
  return <ListingPage key={slug} scope={{ kind: 'brand', slug }} />
}

function Spinner({ label }: { label: string }) {
  return (
    <div role="status" className="grid min-h-[40vh] place-items-center">
      <span className="size-10 animate-spin rounded-full border-4 border-sf-border border-t-sf-accent" aria-hidden />
      <span className="sr-only">{label}</span>
    </div>
  )
}

/**
 * The product listing shared by /shop, /search, /category/:slug and /brand/:slug: header with
 * breadcrumbs, filters (sidebar on desktop, drawer on mobile), toolbar, cards and pagination.
 * Every filter, the sort, page size, page and view live in the URL.
 */
function ListingPage({ scope }: { scope: ListingScope }) {
  const location = useLocation()
  const [params, setParams] = useSearchParams()
  const state = useMemo(() => parseListingState(params), [params])
  const [drawerOpen, setDrawerOpen] = useState(false)
  const { t } = useLocale()

  const category = useCategoryQuery(scope.kind === 'category' ? scope.slug : '', scope.kind === 'category')
  const brand = useBrandQuery(scope.kind === 'brand' ? scope.slug : '', scope.kind === 'brand')
  const needsTerm = scope.kind === 'search' && !state.q
  const listing = useProductListingQuery(toApiQuery(state, scope), !needsTerm)

  const heading =
    scope.kind === 'shop'
      ? t('catalog.listing.shop')
      : scope.kind === 'search'
        ? state.q
          ? t('catalog.listing.searchResults', { q: state.q })
          : t('catalog.listing.search')
        : scope.kind === 'category'
          ? (category.data?.name ?? '')
          : (brand.data?.name ?? '')
  const seoTitle = scope.kind === 'category' ? category.data?.seo.title : scope.kind === 'brand' ? brand.data?.seo.title : null
  const notFound = (scope.kind === 'category' && (isNotFound(category.error) || isNotFound(listing.error))) || (scope.kind === 'brand' && (isNotFound(brand.error) || isNotFound(listing.error)))

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

  // A new page of results starts at the top of the results.
  const resultsRef = useRef<HTMLDivElement>(null)
  const firstPage = useRef(state.page)
  useEffect(() => {
    if (state.page !== firstPage.current) {
      firstPage.current = state.page
      resultsRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })
    }
  }, [state.page])

  const setState = (next: ListingState) => setParams(serializeListingState(next))
  const update = (patch: Partial<ListingState>) => setState({ ...state, ...patch, page: 1 })
  const clear = () => setState(clearFilters(state))
  const hrefFor = (page: number) => {
    const search = serializeListingState({ ...state, page }).toString()
    return `${location.pathname}${search ? `?${search}` : ''}`
  }
  const categoryHref = (slug: string) => {
    const search = serializeListingState({ ...state, q: '', category: null, page: 1 }).toString()
    return `/category/${encodeURIComponent(slug)}${search ? `?${search}` : ''}`
  }

  if (notFound) return <NotFoundPage />

  if ((scope.kind === 'category' && category.isPending) || (scope.kind === 'brand' && brand.isPending)) return <Spinner label={t('catalog.listing.loading')} />

  const breadcrumbs: Breadcrumb[] =
    scope.kind === 'category' && category.data
      ? category.data.breadcrumbs
      : [{ name: t('catalog.listing.home'), url: '/' }, { name: scope.kind === 'search' ? t('catalog.listing.search') : scope.kind === 'brand' ? heading : t('catalog.listing.shop'), url: null }]

  const data = listing.data
  const facets = data?.facets ?? null
  const filterPanel = facets && (
    <FilterPanel scope={scope} state={state} facets={facets} onChange={update} onClear={clear} categoryHref={categoryHref} />
  )

  return (
    <div data-testid="listing-page">
      <ListingHeader heading={heading} breadcrumbs={breadcrumbs} category={category.data} brand={brand.data} />

      <div className="mx-auto max-w-sf px-4 py-8">
        {needsTerm ? (
          <div className="mx-auto flex max-w-xl flex-col gap-4 rounded-sf-card bg-sf-surface p-6 text-center">
            <p>{t('catalog.listing.lookingFor')}</p>
            <HeaderSearch />
          </div>
        ) : (
          <div className={cn('grid gap-8', filterPanel && 'lg:grid-cols-[16rem_minmax(0,1fr)]')}>
            {filterPanel && (
              <aside aria-label={t('catalog.listing.filters')} className="hidden self-start rounded-sf-card bg-sf-surface px-5 py-3 lg:block">
                <h2 className="pt-2 text-lg font-extrabold">{t('catalog.listing.filterBy')}</h2>
                {filterPanel}
              </aside>
            )}

            <section aria-label={t('catalog.listing.products')} className="min-w-0">
              <div className="flex flex-col gap-4 rounded-sf-card bg-sf-surface p-4">
                {filterPanel && (
                  <Button variant="outline" className="self-start rounded-sf-button lg:hidden" onClick={() => setDrawerOpen(true)}>
                    <SlidersHorizontalIcon aria-hidden className="size-4" />
                    {t('catalog.listing.filters')}
                    {hasActiveFilters(state) && <span className="sr-only">{t('catalog.listing.filtersActive')}</span>}
                  </Button>
                )}
                <ListingToolbar
                  pagination={data?.pagination ?? null}
                  sort={state.sort}
                  perPage={state.perPage}
                  view={state.view}
                  onSort={(sort) => update({ sort })}
                  onPerPage={(perPage) => update({ perPage })}
                  onView={(view) => setState({ ...state, view })}
                />
                {facets && <ActiveFilters state={state} facets={facets} listing={data ?? null} onChange={update} onClear={clear} />}
              </div>

              <div ref={resultsRef} className="scroll-mt-32 pt-6">
                <Results listing={listing} state={state} scope={scope} onClear={clear} />
                {data && <Pagination pagination={data.pagination} hrefFor={hrefFor} />}
              </div>
            </section>
          </div>
        )}
      </div>

      {filterPanel && (
        <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
          <SheetContent side="left" className="w-80 max-w-[90vw] gap-0 p-0">
            <SheetHeader className="border-b">
              <SheetTitle className="font-heading text-lg text-sf-heading">{t('catalog.listing.filters')}</SheetTitle>
              <SheetDescription className="sr-only">{t('catalog.listing.narrowDown')}</SheetDescription>
            </SheetHeader>
            <div className="flex-1 overflow-y-auto px-5">{filterPanel}</div>
            <div className="border-t p-4">
              <Button className="w-full rounded-sf-button" onClick={() => setDrawerOpen(false)}>
                {data ? t('catalog.listing.showCount', { count: data.pagination.total }) : t('catalog.listing.showProducts')}
              </Button>
            </div>
          </SheetContent>
        </Sheet>
      )}
    </div>
  )
}

function ListingHeader({ heading, breadcrumbs, category, brand }: { heading: string; breadcrumbs: Breadcrumb[]; category?: StoreCategory; brand?: StoreBrand }) {
  const { t, formatNumber } = useLocale()
  return (
    <header className="bg-sf-surface">
      {category?.banner && (
        <MediaImage media={category.banner} alt="" sizes="100vw" priority className="h-40 w-full object-cover md:h-56" />
      )}
      <div className="mx-auto flex max-w-sf flex-col gap-3 px-4 py-8">
        <Breadcrumbs items={breadcrumbs} />
        <div className="flex items-center gap-4">
          {brand?.logo && <MediaImage media={brand.logo} alt="" sizes="96px" className="h-14 w-auto max-w-32 object-contain" />}
          <h1 className="text-3xl font-extrabold lg:text-4xl">{heading}</h1>
        </div>
        {category?.description_html && <RichText html={category.description_html} className="max-w-3xl" />}
        {brand?.description && <p className="max-w-3xl whitespace-pre-line">{brand.description}</p>}
        {category && category.children.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-2" aria-label={t('catalog.listing.subcategories')}>
            {category.children.map((child) => (
              <li key={child.slug}>
                <Link
                  to={`/category/${encodeURIComponent(child.slug)}`}
                  className="inline-flex items-center gap-2 rounded-full border-2 bg-sf-surface py-1 pr-4 pl-1 text-sm font-semibold text-sf-heading transition hover:border-sf-accent hover:text-sf-accent"
                >
                  {child.image ? (
                    <MediaImage media={child.image} alt="" sizes="32px" className="size-8 rounded-full object-cover" />
                  ) : (
                    <span aria-hidden className="size-2" />
                  )}
                  {child.name}
                  <span className="font-normal text-sf-text">({formatNumber(child.product_count)})</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </header>
  )
}

function ActiveFilters({
  state,
  facets,
  listing,
  onChange,
  onClear,
}: {
  state: ListingState
  facets: ListingFacets
  listing: ProductListing | null
  onChange: (patch: Partial<ListingState>) => void
  onClear: () => void
}) {
  const format = usePriceFormat()
  const { t } = useLocale()
  const chips: { key: string; label: string; remove: Partial<ListingState> }[] = []

  if (state.category) chips.push({ key: 'category', label: listing?.context?.category?.name ?? state.category, remove: { category: null } })
  for (const slug of state.brands) {
    chips.push({ key: `brand-${slug}`, label: facets.brands.find((b) => b.slug === slug)?.name ?? slug, remove: { brands: toggleValue(state.brands, slug) } })
  }
  for (const [slug, values] of Object.entries(state.attrs)) {
    const name = facets.attributes.find((a) => a.slug === slug)?.name ?? slug
    for (const value of values) chips.push({ key: `attr-${slug}-${value}`, label: t('catalog.active.attribute', { name, value }), remove: { attrs: toggleAttribute(state.attrs, slug, value) } })
  }
  if (state.priceMin || state.priceMax) {
    const label =
      state.priceMin && state.priceMax
        ? `${format.price(state.priceMin)} – ${format.price(state.priceMax)}`
        : state.priceMin
          ? t('catalog.active.priceFrom', { price: format.price(state.priceMin) })
          : t('catalog.active.priceUpTo', { price: format.price(state.priceMax ?? '') })
    chips.push({ key: 'price', label, remove: { priceMin: null, priceMax: null } })
  }
  if (state.inStock) chips.push({ key: 'in-stock', label: t('catalog.stock.in'), remove: { inStock: false } })
  if (state.onSale) chips.push({ key: 'on-sale', label: t('catalog.filter.onSale'), remove: { onSale: false } })

  if (chips.length === 0) return null

  return (
    <ul className="flex flex-wrap items-center gap-2" aria-label={t('catalog.active.label')}>
      {chips.map((chip) => (
        <li key={chip.key}>
          <button
            type="button"
            onClick={() => onChange(chip.remove)}
            className="inline-flex items-center gap-1.5 rounded-full bg-sf-canvas px-3 py-1 text-sm font-medium text-sf-heading transition hover:bg-sf-accent hover:text-sf-accent-foreground"
            aria-label={t('catalog.active.remove', { label: chip.label })}
          >
            {chip.label}
            <XIcon aria-hidden className="size-3.5" />
          </button>
        </li>
      ))}
      <li>
        <button type="button" onClick={onClear} className="text-sm font-semibold text-sf-accent underline-offset-4 hover:underline">
          {t('catalog.active.clearAll')}
        </button>
      </li>
    </ul>
  )
}

function Results({
  listing,
  state,
  scope,
  onClear,
}: {
  listing: ReturnType<typeof useProductListingQuery>
  state: ListingState
  scope: ListingScope
  onClear: () => void
}) {
  const { t } = useLocale()
  if (listing.isPending) return <Spinner label={t('catalog.listing.loadingProducts')} />

  if (listing.isError) {
    return (
      <div className="rounded-sf-card bg-sf-surface px-4 py-12 text-center">
        <p className="font-semibold text-sf-heading">{t('catalog.listing.loadFailed')}</p>
        <Button className="mt-4 rounded-sf-button" onClick={() => void listing.refetch()}>{t('common.tryAgain')}</Button>
      </div>
    )
  }

  const { products } = listing.data
  if (products.length === 0) {
    const filtered = hasActiveFilters(state)
    return (
      <div className="rounded-sf-card bg-sf-surface px-4 py-14 text-center" data-testid="listing-empty">
        <h2 className="text-2xl font-bold">
          {filtered ? t('catalog.empty.filteredTitle') : scope.kind === 'search' ? t('catalog.empty.searchTitle', { q: state.q }) : t('catalog.empty.title')}
        </h2>
        <p className="mx-auto mt-2 max-w-md">
          {filtered ? t('catalog.empty.filteredText') : scope.kind === 'search' ? t('catalog.empty.searchText') : t('catalog.empty.text')}
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          {filtered && (
            <Button className="rounded-sf-button" onClick={onClear}>
              {t('catalog.empty.clearFilters')}
            </Button>
          )}
          {scope.kind !== 'shop' && (
            <Link to="/shop" className="inline-flex h-9 items-center rounded-sf-button border px-4 text-sm font-semibold text-sf-heading hover:border-sf-accent">
              {t('catalog.empty.browseAll')}
            </Link>
          )}
        </div>
      </div>
    )
  }

  return (
    <ul
      aria-busy={listing.isPlaceholderData || undefined}
      className={cn(
        'grid gap-3 transition-opacity sm:gap-5',
        state.view === 'list' ? 'grid-cols-1' : 'grid-cols-2 md:grid-cols-3',
        listing.isPlaceholderData && 'opacity-60',
      )}
      data-testid="product-results"
    >
      {products.map((product, i) => (
        <li key={product.id}>
          <ProductCard product={product} layout={state.view} eager={i < 4} />
        </li>
      ))}
    </ul>
  )
}
