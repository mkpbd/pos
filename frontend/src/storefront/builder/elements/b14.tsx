import { createElement, lazy, Suspense, useEffect, useMemo, type ReactNode } from 'react'
import { Link } from 'react-router'
import { cn } from '@/lib/utils'
import { useStorefront } from '../../api'
import { ListingBody, type ListingBodyOptions } from '../../catalog/listing-body'
import { useListingController, type ListingController } from '../../catalog/listing-controller'
import { EMPTY_LISTING_STATE, PER_PAGE_OPTIONS, type ListingDefaults, type ListingScope, type PerPage } from '../../catalog/listing-params'
import { HeaderSearch } from '../../components/header-search'
import { useLocale } from '../../i18n/locale'
import type { ListingColumns, SortKey } from '../../types'
import { DraftPlaceholder } from '../preview-mark'
import { useElementData, usePage } from '../render-context'
import { fieldText, formatDynamicText, storeContext } from '../templates/context'
import { useStorePage } from '../templates/runtime'
import { readListingData, readSampleListing } from '../templates/sample'
import { B14_ENUMS, B14_LIMITS, B14_TEXT_LIMITS, normalizeCardHover, oneOf } from '../validate'
import type { RenderElement } from '../types'
import { isB14Type } from './b14-types'
import { bool, isObject, PRIMARY_BUTTON, SECONDARY_BUTTON, str, type El } from './shared'

/*
 * Renderers of the B14 elements: live text from the page (dynamic_text) and the store page
 * templates' main parts — the product listing (also on normal pages), the blog post, the order
 * summary and the "page not found" message. They read the page context and the route's data
 * (../templates/runtime); the editor canvas gives them its sample instead and nothing is fetched
 * there. Each draws its root with `data-b={id}`.
 */

/** The editor canvas draws the document under the key `canvas` (it fetches nothing). */
function useIsCanvas(): boolean {
  const { page } = usePage()
  const runtime = useStorePage()
  return page.document?.key === 'canvas' || runtime?.canvas === true
}

/** What the canvas draws where a main part has no sample yet (an outline that says so). */
function CanvasOutline({ element, label, children }: { element: RenderElement; label: string; children?: ReactNode }) {
  const { t } = useLocale()
  return (
    <div data-b={element.id} className="flex min-h-40 flex-col gap-3 rounded-sf-card border-2 border-dashed border-sf-border p-4 text-sm text-sf-text" data-testid="template-outline">
      <p className="font-semibold text-sf-heading">{label}</p>
      <p>{t('content.builder.template.noSample')}</p>
      {children}
    </div>
  )
}

/* ---------------------------------------------------------------------------------------------
 * dynamic_text
 * ------------------------------------------------------------------------------------------- */

const TAG_CLASSES = {
  h1: 'sf-heading-case text-4xl font-extrabold lg:text-5xl',
  h2: 'sf-heading-case text-3xl font-extrabold lg:text-4xl',
  h3: 'sf-heading-case text-2xl font-bold',
  p: undefined,
  span: undefined,
} as const

/** "Text from this page": a value of the page context with its prefix and suffix, or the fallback. */
export function DynamicTextElement({ element }: { element: El<'dynamic_text'> }) {
  const runtime = useStorePage()
  const bootstrap = useStorefront()
  const { draft } = usePage()
  const canvas = useIsCanvas()
  const { t, formatNumber, formatDate, digits } = useLocale()
  const p = element.props ?? {}
  const field = oneOf(p.field, B14_ENUMS.dynamicField)
  const tag = oneOf(p.tag, B14_ENUMS.dynamicTag) ?? 'p'
  const format = oneOf(p.format, B14_ENUMS.dynamicFormat) ?? 'default'
  const L = B14_TEXT_LIMITS.dynamic_text
  const prefix = str(p.prefix).slice(0, L.prefix)
  const suffix = str(p.suffix).slice(0, L.suffix)
  const fallback = str(p.fallback).slice(0, L.fallback).trim()
  // A normal page (or a canvas without a sample) knows the store.
  const context = runtime?.context ?? (canvas ? null : { template: null, store: storeContext(bootstrap) })
  const value = field ? fieldText(context, field, format, { t, formatNumber, formatDate, digits }, bootstrap.store.currency) : null
  const draw = (testId: string, ...children: ReactNode[]) => createElement(tag, { 'data-b': element.id, className: TAG_CLASSES[tag], 'data-field': field, 'data-testid': testId }, ...children)

  if (value === null) {
    if (fallback) return draw('dynamic-text', fallback)
    // The editor's canvas shows where the value goes until a sample fills it.
    if (canvas && field) {
      const [before = '', after = ''] = (formatDynamicText(prefix, TOKEN, suffix, '') ?? TOKEN).split(TOKEN)
      return draw(
        'dynamic-text-token',
        before,
        <span key="token" className="rounded border border-dashed border-sf-border px-1 text-sf-text">
          {t('content.builder.template.field', { field })}
        </span>,
        after,
      )
    }
    return draft ? <DraftPlaceholder element={element} /> : null
  }
  return draw('dynamic-text', formatDynamicText(prefix, value, suffix, fallback))
}

/** Stands for the value while the canvas has no sample. */
const TOKEN = '\u0000'

/* ---------------------------------------------------------------------------------------------
 * product_listing
 * ------------------------------------------------------------------------------------------- */

type ListingSetup = { defaults: ListingDefaults; options: ListingBodyOptions; loadMore: boolean }

function columnsOf(value: unknown): ListingColumns {
  const c = isObject(value) ? value : {}
  const pick = <N extends number>(v: unknown, range: { min: number; max: number }, fallback: N): N => (typeof v === 'number' && Number.isInteger(v) && v >= range.min && v <= range.max ? (v as N) : fallback)
  return {
    desktop: pick(c.desktop, B14_LIMITS.columns.desktop, 3),
    tablet: pick(c.tablet, B14_LIMITS.columns.tablet, 3),
    mobile: pick(c.mobile, B14_LIMITS.columns.mobile, 2),
  }
}

/** The element's props as the listing body's options (every value checked again). */
function useListingSetup(element: El<'product_listing'>): ListingSetup {
  const p = element.props
  const key = JSON.stringify([p?.scope, p?.sort_default, p?.per_page, p?.filters, p?.filter_layout, p?.columns, p?.show_count, p?.pagination])
  return useMemo(() => {
    const props = (element.props ?? {}) as Record<string, unknown>
    const filters = isObject(props.filters) ? props.filters : {}
    const sort: SortKey = props.scope === 'new_arrivals' ? 'latest' : (oneOf(props.sort_default, B14_ENUMS.listingSort) ?? 'featured')
    const perPage = (PER_PAGE_OPTIONS as readonly unknown[]).includes(props.per_page) ? (props.per_page as PerPage) : 24
    const loadMore = props.pagination === 'load_more'
    return {
      defaults: { sort, perPage },
      loadMore,
      options: {
        filters: Object.fromEntries(B14_ENUMS.listingFilters.map((kind) => [kind, bool(filters[kind], true)])),
        filterLayout: oneOf(props.filter_layout, B14_ENUMS.filterLayout) ?? 'sidebar',
        columns: columnsOf(props.columns),
        showCount: bool(props.show_count, true),
        pagination: loadMore ? 'load_more' : 'pages',
        className: 'w-full',
      },
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the props by value
  }, [key])
}

/** The store's product listing (filters, sort, count, pages) — the template's own listing, or the chosen products on a normal page. */
export function ProductListingElement({ element }: { element: El<'product_listing'> }) {
  const canvas = useIsCanvas()
  const runtime = useStorePage()
  const data = useElementData(element.id)
  const setup = useListingSetup(element)
  const scopeProp = oneOf(element.props?.scope, B14_ENUMS.listingScope) ?? 'all'
  const slugs = readListingData(data)
  const scopeKey = JSON.stringify([scopeProp, slugs, runtime?.listing?.scope])
  const scope = useMemo<ListingScope | null>(() => {
    if (scopeProp === 'current') return runtime?.listing?.scope ?? { kind: 'shop' }
    if (scopeProp === 'categories') return slugs && slugs.category_slugs.length > 0 ? { kind: 'selection', categories: slugs.category_slugs, brands: [], onSale: false } : null
    if (scopeProp === 'brands') return slugs && slugs.brand_slugs.length > 0 ? { kind: 'selection', categories: [], brands: slugs.brand_slugs, onSale: false } : null
    return { kind: 'selection', categories: [], brands: [], onSale: scopeProp === 'on_sale' }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- by value
  }, [scopeKey])

  if (canvas) return <CanvasListing element={element} setup={setup} scope={scope ?? { kind: 'shop' }} />
  // Chosen categories / brands that are all gone: nothing to list (a draft keeps the place).
  if (!scope) return <DraftPlaceholder element={element} />
  return <LiveListing element={element} setup={setup} scope={scope} reportTotal={scopeProp === 'current' ? runtime?.listing?.onTotal : undefined} />
}

function LiveListing({ element, setup, scope, reportTotal }: { element: RenderElement; setup: ListingSetup; scope: ListingScope; reportTotal?: (total: number | null) => void }) {
  const controller = useListingController(scope, { defaults: setup.defaults, loadMore: setup.loadMore })
  const total = controller.results.data?.pagination.total ?? null
  useEffect(() => {
    reportTotal?.(total)
  }, [reportTotal, total])
  return (
    <div data-b={element.id} className="b-product-listing" data-testid="builder-product-listing" data-b-card-hover={normalizeCardHover(element.type, (element.props as { card_hover?: unknown } | undefined)?.card_hover)}>
      <ListingBody controller={controller} options={setup.options} />
    </div>
  )
}

const noop = () => {}

/** The canvas: the sample's first page drawn by the same body, with nothing to fetch and nowhere to go. */
function CanvasListing({ element, setup, scope }: { element: RenderElement; setup: ListingSetup; scope: ListingScope }) {
  const runtime = useStorePage()
  const { t } = useLocale()
  const listing = useMemo(() => readSampleListing(runtime?.sample?.listing), [runtime?.sample?.listing])
  if (!listing) {
    return (
      <CanvasOutline element={element} label={t('content.builder.template.listing')}>
        <ul aria-hidden className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <li key={i} className="aspect-[3/4] rounded-sf-card bg-sf-surface" />
          ))}
        </ul>
      </CanvasOutline>
    )
  }
  const controller: ListingController = {
    scope,
    state: { ...EMPTY_LISTING_STATE, sort: setup.defaults.sort, perPage: setup.defaults.perPage },
    defaults: setup.defaults,
    needsTerm: false,
    results: { isPending: false, isError: false, isPlaceholderData: false, isLoadingMore: false, data: listing, error: null, refetch: noop },
    setState: noop,
    update: noop,
    clear: noop,
    hrefFor: () => '#',
    categoryHref: () => '#',
  }
  return (
    <div data-b={element.id} className="b-product-listing" data-testid="builder-product-listing" data-b-card-hover={normalizeCardHover(element.type, (element.props as { card_hover?: unknown } | undefined)?.card_hover)}>
      <ListingBody controller={controller} options={setup.options} />
    </div>
  )
}

/* ---------------------------------------------------------------------------------------------
 * blog_post_body, order_summary — drawn by the blog and order pages' own components (split off,
 * as those pages are)
 * ------------------------------------------------------------------------------------------- */

const BlogPostView = lazy(() => import('../../blog/blog-pages').then((m) => ({ default: m.BlogPostView })))
const OrderDetails = lazy(() => import('../../orders/order-page').then((m) => ({ default: m.OrderDetails })))

function PartLoading({ id }: { id: string }) {
  const { t } = useLocale()
  return (
    <div data-b={id} role="status" className="grid min-h-40 place-items-center">
      <span className="size-8 animate-spin rounded-full border-4 border-sf-border border-t-sf-accent motion-reduce:animate-none" aria-hidden />
      <span className="sr-only">{t('content.loading')}</span>
    </div>
  )
}

/** The post: title, cover, meta line, body, share bar and related posts (each part can be switched off). */
export function BlogPostBodyElement({ element }: { element: El<'blog_post_body'> }) {
  const runtime = useStorePage()
  const canvas = useIsCanvas()
  const { t } = useLocale()
  const post = canvas ? (runtime?.sample?.post ?? null) : (runtime?.post?.post ?? null)
  if (!post) return canvas ? <CanvasOutline element={element} label={t('content.builder.template.post')} /> : <DraftPlaceholder element={element} />
  const p = element.props ?? {}
  const show = { cover: bool(p.show_cover, true), meta: bool(p.show_meta, true), share: bool(p.show_share, true), related: bool(p.show_related, true) }
  return (
    <div data-b={element.id} className="b-blog-post" data-testid="builder-blog-post">
      <Suspense fallback={<PartLoading id={`${element.id}-loading`} />}>
        <BlogPostView post={post} preview={canvas || runtime?.post?.preview === true} show={show} />
      </Suspense>
    </div>
  )
}

/** The order's status page content: status, timeline, items, totals, payment and delivery details. */
export function OrderSummaryElement({ element }: { element: El<'order_summary'> }) {
  const runtime = useStorePage()
  const canvas = useIsCanvas()
  const { t } = useLocale()
  // Never from a payload: the route loads it with the guest's token or the owner's session; the canvas gets a masked sample.
  const loaded = canvas ? (runtime?.sample?.order ? { order: runtime.sample.order, thankYou: true, accountLink: false } : null) : (runtime?.order ?? null)
  if (!loaded) return canvas ? <CanvasOutline element={element} label={t('content.builder.template.order')} /> : <DraftPlaceholder element={element} />
  const p = element.props ?? {}
  const show = { timeline: bool(p.show_timeline, true), items: bool(p.show_items, true), address: bool(p.show_address, true), delivery: bool(p.show_delivery, true) }
  return (
    <div data-b={element.id} className="b-order-summary" data-testid="builder-order-summary">
      <Suspense fallback={<PartLoading id={`${element.id}-loading`} />}>
        <OrderDetails order={loaded.order} thankYou={loaded.thankYou} accountLink={loaded.accountLink} show={show} className="w-full py-6" />
      </Suspense>
    </div>
  )
}

/* ---------------------------------------------------------------------------------------------
 * not_found_message
 * ------------------------------------------------------------------------------------------- */

/** "Page not found": the heading, a short text, a search box and the way back to the shop and home. */
export function NotFoundMessageElement({ element }: { element: El<'not_found_message'> }) {
  const { t, digits } = useLocale()
  const p = element.props ?? {}
  const L = B14_TEXT_LIMITS.not_found_message
  const heading = str(p.heading).slice(0, L.heading).trim() || t('content.notFound.title')
  const text = str(p.text).slice(0, L.text).trim()
  return (
    <section data-b={element.id} className="b-not-found flex flex-col items-center gap-4 py-12 text-center" data-testid="builder-not-found">
      <p aria-hidden className="font-heading text-7xl font-extrabold text-sf-accent">{digits('404')}</p>
      <h1 className="sf-heading-case text-3xl font-bold">{heading}</h1>
      {text && <p className="mx-auto max-w-md whitespace-pre-line">{text}</p>}
      {bool(p.show_search, true) && (
        <div className="w-full max-w-md">
          <HeaderSearch />
        </div>
      )}
      {bool(p.show_links, true) && (
        <nav aria-label={t('content.notFound.links')} className="flex flex-wrap justify-center gap-3">
          <Link to="/shop" className={PRIMARY_BUTTON}>
            {t('content.notFound.shop')}
          </Link>
          <Link to="/" className={cn(SECONDARY_BUTTON)}>
            {t('content.notFound.back')}
          </Link>
        </nav>
      )}
    </section>
  )
}

/* -------------------------------------------------------------------------------------------- */

const RENDERERS = {
  dynamic_text: DynamicTextElement,
  product_listing: ProductListingElement,
  blog_post_body: BlogPostBodyElement,
  order_summary: OrderSummaryElement,
  not_found_message: NotFoundMessageElement,
} as const

export function B14ElementContent({ element }: { element: RenderElement }) {
  if (!isB14Type(element.type)) return null
  const Render = RENDERERS[element.type] as (props: { element: RenderElement }) => ReactNode
  return <Render element={element} />
}
