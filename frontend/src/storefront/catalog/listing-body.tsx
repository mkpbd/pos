import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { SlidersHorizontalIcon, XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { cn } from '@/lib/utils'
import { useStorefront } from '../api'
import { listingGridClasses } from '../builder/listing-columns'
import { normalizeListingColumns } from '../builder/validate'
import { HeaderSearch } from '../components/header-search'
import { useLocale } from '../i18n/locale'
import { usePriceFormat } from '../money'
import type { ListingColumns, ListingFacets, ListingPagination, ProductListing } from '../types'
import { FilterPanel, type FilterKind } from './filter-panel'
import type { ListingController, ListingResults } from './listing-controller'
import { hasActiveFilters, toggleAttribute, toggleValue, type ListingScope, type ListingState } from './listing-params'
import { ListingToolbar, Pagination } from './listing-toolbar'
import { ProductCard } from './product-card'

/*
 * The product listing body shared by the store's listing pages (/shop, /search, /category/:slug,
 * /brand/:slug) and the store builder's product listing element (B14): filters, toolbar, active
 * filter chips, cards and pagination. Every filter, the sort, page size, page and view live in the
 * page URL (shareable, back button works).
 */

export function ListingSpinner({ label }: { label: string }) {
  return (
    <div role="status" className="grid min-h-[40vh] place-items-center">
      <span className="size-10 animate-spin rounded-full border-4 border-sf-border border-t-sf-accent" aria-hidden />
      <span className="sr-only">{label}</span>
    </div>
  )
}

export type ListingBodyOptions = {
  /** Filter groups offered (absent = all). */
  filters?: Partial<Record<FilterKind, boolean>>
  /** `sidebar` (default): a column on desktop, a drawer on phones; `top`: a filter bar above the results; `drawer`: always behind a button. */
  filterLayout?: 'sidebar' | 'top' | 'drawer'
  /** Products per row (absent = the theme's listing columns). */
  columns?: ListingColumns
  showCount?: boolean
  pagination?: 'pages' | 'load_more'
  /** The wrapper's classes (default: the store's page container). */
  className?: string
}

/** Filters, toolbar, active filters, results and pagination of a listing. */
export function ListingBody({ controller, options = {} }: { controller: ListingController; options?: ListingBodyOptions }) {
  const { scope, state, needsTerm, results, update, clear, setState, hrefFor, categoryHref } = controller
  const [drawerOpen, setDrawerOpen] = useState(false)
  const { t } = useLocale()
  const layout = options.filterLayout ?? 'sidebar'
  const loadMore = options.pagination === 'load_more'
  const anyFilter = !options.filters || Object.values(options.filters).some((on) => on !== false)

  // A new page of results starts at the top of the results (not when more are added below).
  const resultsRef = useRef<HTMLDivElement>(null)
  const firstPage = useRef(state.page)
  useEffect(() => {
    if (state.page !== firstPage.current) {
      firstPage.current = state.page
      if (!loadMore) resultsRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })
    }
  }, [state.page, loadMore])

  const data = results.data
  const facets = data?.facets ?? null
  const panel = (row: boolean) =>
    facets && anyFilter ? (
      <FilterPanel scope={scope} state={state} facets={facets} onChange={update} onClear={clear} categoryHref={categoryHref} show={options.filters} layout={row ? 'row' : 'column'} />
    ) : null
  const filterPanel = panel(false)
  const sidebar = layout === 'sidebar' && filterPanel
  const topBar = layout === 'top' ? panel(true) : null
  // The drawer button: phones only beside a sidebar or top bar, every size for `drawer`.
  const drawerButtonClass = layout === 'drawer' ? 'self-start rounded-sf-button' : 'self-start rounded-sf-button lg:hidden'

  return (
    <div className={options.className ?? 'mx-auto max-w-sf px-4 py-8'}>
      {needsTerm ? (
        <div className="mx-auto flex max-w-xl flex-col gap-4 rounded-sf-card bg-sf-surface p-6 text-center">
          <p>{t('catalog.listing.lookingFor')}</p>
          <HeaderSearch />
        </div>
      ) : (
        <div className={cn('grid gap-8', sidebar && 'lg:grid-cols-[16rem_minmax(0,1fr)]')}>
          {sidebar && (
            <aside aria-label={t('catalog.listing.filters')} className="hidden self-start rounded-sf-card bg-sf-surface px-5 py-3 lg:block">
              <h2 className="pt-2 text-lg font-extrabold">{t('catalog.listing.filterBy')}</h2>
              {filterPanel}
            </aside>
          )}

          <section aria-label={t('catalog.listing.products')} className="min-w-0">
            {topBar && (
              <aside aria-label={t('catalog.listing.filters')} className="mb-4 hidden rounded-sf-card bg-sf-surface px-5 py-3 lg:block" data-testid="filter-bar">
                <h2 className="pt-2 text-lg font-extrabold">{t('catalog.listing.filterBy')}</h2>
                {topBar}
              </aside>
            )}
            <div className="flex flex-col gap-4 rounded-sf-card bg-sf-surface p-4">
              {filterPanel && (
                <Button variant="outline" className={drawerButtonClass} onClick={() => setDrawerOpen(true)}>
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
                showCount={options.showCount}
              />
              {facets && <ActiveFilters state={state} facets={facets} listing={data ?? null} onChange={update} onClear={clear} />}
            </div>

            <div ref={resultsRef} className="scroll-mt-32 pt-6">
              <Results results={results} state={state} scope={scope} onClear={clear} columns={options.columns} />
              {data &&
                (loadMore ? (
                  <LoadMore pagination={data.pagination} loading={results.isLoadingMore} onMore={() => setState({ ...state, page: state.page + 1 })} />
                ) : (
                  <Pagination pagination={data.pagination} hrefFor={hrefFor} />
                ))}
            </div>
          </section>
        </div>
      )}

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

/** B14 "Load more": adds the next page below (the address keeps `?page=N`, so back and a shared link show the same). */
function LoadMore({ pagination, loading, onMore }: { pagination: ListingPagination; loading: boolean; onMore: () => void }) {
  const { t } = useLocale()
  const shown = Math.min(pagination.total, pagination.per_page)
  if (shown >= pagination.total) return null
  return (
    <div className="mt-8 flex justify-center">
      <Button className="h-11 rounded-sf-button px-8" onClick={onMore} disabled={loading} aria-busy={loading || undefined} data-testid="load-more">
        {loading ? t('catalog.listing.loadingProducts') : t('catalog.listing.loadMore')}
      </Button>
    </div>
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
        <button type="button" onClick={onClear} className="text-sm font-semibold text-sf-link underline-offset-4 hover:underline">
          {t('catalog.active.clearAll')}
        </button>
      </li>
    </ul>
  )
}

function Results({
  results,
  state,
  scope,
  onClear,
  columns: ownColumns,
}: {
  results: ListingResults
  state: ListingState
  scope: ListingScope
  onClear: () => void
  columns?: ListingColumns
}) {
  const { t } = useLocale()
  const themeColumns = normalizeListingColumns(useStorefront().theme.layout.listing_columns)
  const columns = ownColumns ?? themeColumns
  if (results.isPending) return <ListingSpinner label={t('catalog.listing.loadingProducts')} />

  if (results.isError || !results.data) {
    return (
      <div className="rounded-sf-card bg-sf-surface px-4 py-12 text-center">
        <p className="font-semibold text-sf-heading">{t('catalog.listing.loadFailed')}</p>
        <Button className="mt-4 h-11 rounded-sf-button px-6" onClick={() => results.refetch()}>{t('common.tryAgain')}</Button>
      </div>
    )
  }

  const { products } = results.data
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
            <Button className="h-11 rounded-sf-button px-6" onClick={onClear}>
              {t('catalog.empty.clearFilters')}
            </Button>
          )}
          {scope.kind !== 'shop' && (
            <Link to="/shop" className="inline-flex h-11 items-center rounded-sf-button border bg-sf-surface px-6 text-sm font-semibold text-sf-heading transition-colors hover:border-sf-accent hover:text-sf-accent">
              {t('catalog.empty.browseAll')}
            </Link>
          )}
        </div>
      </div>
    )
  }

  return (
    <ul
      aria-busy={results.isPlaceholderData || results.isLoadingMore || undefined}
      className={cn('grid gap-3 transition-opacity sm:gap-5', state.view === 'list' ? 'grid-cols-1' : listingGridClasses(columns), results.isPlaceholderData && 'opacity-60')}
      data-testid="product-results"
      data-columns={state.view === 'list' ? undefined : `${columns.desktop}-${columns.tablet}-${columns.mobile}`}
    >
      {products.map((product, i) => (
        <li key={product.id}>
          <ProductCard product={product} layout={state.view} eager={i < 4} />
        </li>
      ))}
    </ul>
  )
}
