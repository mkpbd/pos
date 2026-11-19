import { useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { useBrandQuery, useCategoryQuery } from '../catalog/api'
import { Breadcrumbs } from '../catalog/breadcrumbs'
import { ListingBody, ListingSpinner } from '../catalog/listing-body'
import { useListingController } from '../catalog/listing-controller'
import { parseListingState, type ListingScope } from '../catalog/listing-params'
import { useStorefront } from '../api'
import { useTemplateQuery } from '../builder/api'
import { brandContext, categoryContext, storeContext } from '../builder/templates/context'
import type { StorePageRuntime } from '../builder/templates/runtime'
import { useTemplateEnabled } from '../builder/templates/enabled'
import { StoreTemplateView } from '../builder/templates/template-view'
import type { StoreTemplateKey } from '../builder/templates/types'
import { BuilderZone } from '../builder/zone'
import { MediaImage } from '../components/media-image'
import { RichText } from '../components/rich-text'
import { useLocale } from '../i18n/locale'
import type { Breadcrumb, StoreBrand, StoreCategory } from '../types'
import { useListingMeta } from './listing-meta'
import { NotFoundPage } from './not-found-page'

export function ShopPage() {
  return <ListingRoute scope={{ kind: 'shop' }} template="shop" />
}

export function SearchPage() {
  return <ListingRoute scope={{ kind: 'search' }} template="search" />
}

export function CategoryPage() {
  const { slug = '' } = useParams()
  return <ListingRoute key={slug} scope={{ kind: 'category', slug }} template="category" />
}

export function BrandPage() {
  const { slug = '' } = useParams()
  return <ListingRoute key={slug} scope={{ kind: 'brand', slug }} template="brand" />
}

/** B14: the store page template when one is published for this page type, else the standard listing page. */
function ListingRoute({ scope, template }: { scope: ListingScope; template: StoreTemplateKey }) {
  const enabled = useTemplateEnabled(template)
  return enabled ? <TemplateListingPage scope={scope} template={template} /> : <ListingPage scope={scope} />
}

/**
 * A listing page drawn from its template: the route still loads the category / brand (404s, meta,
 * the page context) and keeps the standard page's meta; the template's product listing element
 * draws the products with the URL's filters and reports the total for the page context.
 */
function TemplateListingPage({ scope, template }: { scope: ListingScope; template: StoreTemplateKey }) {
  const [params] = useSearchParams()
  const state = useMemo(() => parseListingState(params), [params])
  const bootstrap = useStorefront()
  const { t } = useLocale()
  const [total, setTotal] = useState<number | null>(null)
  // Starts loading the template alongside the category / brand.
  useTemplateQuery(template)

  const category = useCategoryQuery(scope.kind === 'category' ? scope.slug : '', scope.kind === 'category')
  const brand = useBrandQuery(scope.kind === 'brand' ? scope.slug : '', scope.kind === 'brand')
  // The listing's own 404 (an unknown category / brand) is the category / brand query's too.
  const { heading, notFound } = useListingMeta(scope, state, category, brand, null)

  const runtime = useMemo<StorePageRuntime>(
    () => ({
      context: {
        template,
        store: storeContext(bootstrap),
        category: scope.kind === 'category' && category.data ? categoryContext(category.data, total) : null,
        brand: scope.kind === 'brand' && brand.data ? brandContext(brand.data, total) : null,
        search: scope.kind === 'search' ? { query: state.q, result_count: state.q ? total : null } : null,
      },
      listing: { scope, onTotal: setTotal },
    }),
    [template, bootstrap, scope, category.data, brand.data, state.q, total],
  )

  if (notFound) return <NotFoundPage />
  if ((scope.kind === 'category' && category.isPending) || (scope.kind === 'brand' && brand.isPending)) return <ListingSpinner label={t('catalog.listing.loading')} />
  if (scope.kind === 'category' && category.error) return <ListingPage scope={scope} />
  if (scope.kind === 'brand' && brand.error) return <ListingPage scope={scope} />

  return (
    <div data-testid="listing-page">
      <StoreTemplateView template={template} runtime={runtime} fallback={<ListingPage scope={scope} />} heading={heading} />
    </div>
  )
}

/**
 * The product listing shared by /shop, /search, /category/:slug and /brand/:slug: header with
 * breadcrumbs, filters (sidebar on desktop, drawer on mobile), toolbar, cards and pagination.
 * Every filter, the sort, page size, page and view live in the URL.
 */
function ListingPage({ scope }: { scope: ListingScope }) {
  const controller = useListingController(scope)
  const { state, results: listing } = controller
  const { t } = useLocale()

  const category = useCategoryQuery(scope.kind === 'category' ? scope.slug : '', scope.kind === 'category')
  const brand = useBrandQuery(scope.kind === 'brand' ? scope.slug : '', scope.kind === 'brand')
  const { heading, notFound } = useListingMeta(scope, state, category, brand, listing.error)

  if (notFound) return <NotFoundPage />

  if ((scope.kind === 'category' && category.isPending) || (scope.kind === 'brand' && brand.isPending)) return <ListingSpinner label={t('catalog.listing.loading')} />

  const breadcrumbs: Breadcrumb[] =
    scope.kind === 'category' && category.data
      ? category.data.breadcrumbs
      : [{ name: t('catalog.listing.home'), url: '/' }, { name: scope.kind === 'search' ? t('catalog.listing.search') : scope.kind === 'brand' ? heading : t('catalog.listing.shop'), url: null }]

  return (
    <div data-testid="listing-page">
      <ListingHeader heading={heading} breadcrumbs={breadcrumbs} category={category.data} brand={brand.data} />
      <BuilderZone zone="listing.top" />
      <ListingBody controller={controller} />
      <BuilderZone zone="listing.bottom" />
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
