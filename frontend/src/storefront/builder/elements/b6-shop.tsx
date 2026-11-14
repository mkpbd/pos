import { useEffect, useId, useRef, useState } from 'react'
import { Link, useParams } from 'react-router'
import { ArrowRightIcon, PlusIcon, XIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { AddToCartForm, CardCartAction } from '../../cart/add-to-cart'
import { useProductsBySlugsQuery } from '../../catalog/api'
import { CardPrice } from '../../catalog/card-parts'
import { useCardPricing } from '../../catalog/card-pricing'
import { ProductCard } from '../../catalog/product-card'
import { ProductGallery } from '../../catalog/product-gallery'
import { galleryVideoOf } from '../../catalog/product-video'
import { ProductImage } from '../../catalog/product-image'
import { PRODUCT_RAIL_ITEM, Rail } from '../../catalog/product-rail'
import { ProductSummary } from '../../catalog/product-summary'
import { readRecentlyViewed } from '../../catalog/recently-viewed'
import { imageIndexOf, useVariantSelection } from '../../catalog/use-variant-selection'
import { initialVariant } from '../../catalog/variant-selection'
import { MediaImage } from '../../components/media-image'
import { useLocale } from '../../i18n/locale'
import type { ProductCard as Card } from '../../types'
import { DraftPlaceholder } from '../preview-mark'
import { usePage } from '../render-context'
import type { CategoryCardData, Hotspot, ProductSpotlightData, ShopTheLookData } from '../types'
import { B6_ENUMS, B6_LIMITS, B6_TEXT_LIMITS, boundedInt, hasTwoDecimals, isUuid, listItems, oneOf, safeUrl } from '../validate'
import { isCategoryCardData, isProductSpotlightData, isShopTheLookData } from './guards'
import { str, type El } from './shared'
import { WithData } from './with-data'

/*
 * B6 shop elements (contract §1 "Shop"): category card, product spotlight, shop the look and
 * recently viewed. Product data always comes from the server (or, for recently viewed, the
 * catalogue API) — the document holds ids only. They reuse the storefront's own pieces: product
 * summary with the variant selector, add to cart, cards, prices and the rail.
 */

function useMediaById(id: unknown) {
  const { page } = usePage()
  return typeof id === 'string' && Object.hasOwn(page.media ?? {}, id) ? { id, ...page.media[id]! } : null
}

/* -------------------------------------------------------------------------------------------- */

/** One category: its image (or the chosen one), name, product count and a button, all one link. */
export function CategoryCardElement({ element }: { element: El<'category_card'> }) {
  return <WithData element={element} is={isCategoryCardData}>{(data) => <CategoryCardBody element={element} data={data} />}</WithData>
}

function CategoryCardBody({ element, data }: { element: El<'category_card'>; data: CategoryCardData }) {
  const { t } = useLocale()
  const p = element.props ?? {}
  const override = useMediaById(p.media_id)
  const image = override ?? data.image
  const title = (typeof p.title === 'string' && p.title.trim().slice(0, B6_TEXT_LIMITS.category_card.title)) || data.name
  const button = str(p.button_label).slice(0, B6_TEXT_LIMITS.category_card.button_label).trim()
  const overlay = oneOf(p.layout, B6_ENUMS.categoryCardLayout) !== 'below'
  const url = safeUrl(data.url) ?? '/shop'
  const count = typeof data.product_count === 'number' && data.product_count >= 0 ? data.product_count : null

  return (
    <Link
      to={url}
      data-b={element.id}
      data-layout={overlay ? 'overlay' : 'below'}
      className="b-category-card group relative flex flex-col overflow-hidden rounded-sf-card border bg-sf-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sf-accent"
      data-testid="builder-category-card"
    >
      <div className="relative aspect-[4/3] overflow-hidden bg-sf-canvas">
        {image && <MediaImage media={image} alt="" sizes="(max-width: 639px) 100vw, 33vw" className="size-full object-cover transition-transform duration-500 group-hover:scale-105 motion-reduce:transition-none motion-reduce:group-hover:scale-100" />}
        {overlay && <span aria-hidden className="absolute inset-0 bg-linear-to-t from-black/70 via-black/20 to-transparent" />}
      </div>
      <div className={cn('flex flex-col gap-1 p-5', overlay && 'absolute inset-x-0 bottom-0 text-white')}>
        <h3 className={cn('font-heading text-xl font-extrabold', !overlay && 'text-sf-heading')}>{title}</h3>
        {count !== null && <p className="text-sm">{t('content.builder.category.count', { count })}</p>}
        {button && (
          <span className={cn('mt-2 inline-flex items-center gap-1.5 text-sm font-bold underline-offset-4 group-hover:underline', !overlay && 'text-sf-link')}>
            {button}
            <ArrowRightIcon aria-hidden className="size-4" />
          </span>
        )}
      </div>
    </Link>
  )
}

/* -------------------------------------------------------------------------------------------- */

/** One product, large, buyable in place: gallery, price, variant choice, quantity and add to cart. */
export function ProductSpotlightElement({ element }: { element: El<'product_spotlight'> }) {
  return <WithData element={element} is={isProductSpotlightData}>{(product) => <SpotlightBody key={product.id} element={element} product={product} />}</WithData>
}

function SpotlightBody({ element, product: data }: { element: El<'product_spotlight'>; product: ProductSpotlightData }) {
  const { t } = useLocale()
  const p = element.props ?? {}
  const product = p.show_description === false ? { ...data, short_description: null } : data
  const [imageIndex, setImageIndex] = useState(() => Math.max(0, imageIndexOf(product, initialVariant(product)?.image_id)))
  const { selection, variant, choose } = useVariantSelection(product, null, (next) => {
    const i = imageIndexOf(product, next?.image_id)
    if (i >= 0) setImageIndex(i)
  })
  const badge = str(p.badge).slice(0, B6_TEXT_LIMITS.product_spotlight.badge).trim()
  const imageRight = oneOf(p.layout, B6_ENUMS.spotlightLayout) === 'image-right'
  const url = safeUrl(product.url) ?? '/shop'
  const headingId = useId()

  return (
    <article data-b={element.id} aria-labelledby={headingId} className="b-spotlight grid gap-8 md:grid-cols-2" data-layout={imageRight ? 'image-right' : 'image-left'} data-testid="builder-spotlight">
      <div className={cn('relative min-w-0', imageRight && 'md:order-2')}>
        <ProductGallery images={product.images} name={product.name} index={imageIndex} onIndexChange={setImageIndex} video={galleryVideoOf(product)} />
        {badge && (
          <span aria-hidden className="pointer-events-none absolute top-3 left-3 rounded-full bg-sf-sale px-3 py-1 text-xs font-bold tracking-wide text-white uppercase">
            {badge}
          </span>
        )}
      </div>
      <div className="flex min-w-0 flex-col gap-4">
        {badge && <p className="sr-only">{badge}</p>}
        <h2 id={headingId} className="font-heading text-3xl font-extrabold text-sf-heading">
          <Link to={url} className="hover:text-sf-accent">
            {product.name}
          </Link>
        </h2>
        <ProductSummary product={product} variant={variant} selection={selection} onChoose={choose} />
        <AddToCartForm key={variant?.id ?? 'none'} product={product} variant={variant} />
        <Link to={url} className="inline-flex items-center gap-2 self-start text-sm font-bold text-sf-link underline-offset-4 hover:underline">
          {t('content.builder.spotlight.details')}
          <ArrowRightIcon aria-hidden className="size-4" />
        </Link>
      </div>
    </article>
  )
}

/* -------------------------------------------------------------------------------------------- */

type Spot = Hotspot & { product: Card }

/** The hotspots whose product the payload has (unavailable ones are absent publicly). */
function spotsOf(value: unknown, products: Record<string, Card>): Spot[] {
  return listItems(value, B6_LIMITS.hotspots.max).flatMap((item) => {
    const { x, y, product_id: productId } = item
    if (!hasTwoDecimals(x) || !hasTwoDecimals(y) || x < 0 || x > 100 || y < 0 || y > 100 || !isUuid(productId)) return []
    const product = Object.hasOwn(products, productId) ? products[productId] : undefined
    return product ? [{ id: item.id as string, x, y, product_id: productId, product }] : []
  })
}

/**
 * A photo with dots on the products in it. Each dot is a button ("Show <product>") that opens a
 * small card (image, name, price, link, add to cart); Escape or the close button closes it and
 * the focus returns to the dot. On phones the products are also listed under the photo.
 */
export function ShopTheLookElement({ element }: { element: El<'shop_the_look'> }) {
  return <WithData element={element} is={isShopTheLookData}>{(data) => <LookBody element={element} data={data} />}</WithData>
}

function LookBody({ element, data }: { element: El<'shop_the_look'>; data: ShopTheLookData }) {
  const { t } = useLocale()
  const p = element.props ?? {}
  const image = useMediaById(p.media_id)
  const spots = spotsOf(p.hotspots, Array.isArray(data.products) ? {} : (data.products ?? {}))
  const title = str(p.title).slice(0, B6_TEXT_LIMITS.shop_the_look.title).trim()
  const alt = str(p.alt).slice(0, B6_TEXT_LIMITS.shop_the_look.alt).trim()
  const [open, setOpen] = useState<string | null>(null)
  const dots = useRef(new Map<string, HTMLButtonElement | null>())
  const base = useId()

  const close = (focus: boolean) => {
    const id = open
    setOpen(null)
    if (focus && id) dots.current.get(id)?.focus()
  }

  // A press outside the open card closes it (the focus stays where the visitor pressed).
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Element | null
      if (target && !target.closest('[data-look-card]') && !target.closest('[data-look-dot]')) setOpen(null)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  if (!image || spots.length === 0) return <DraftPlaceholder element={element} />

  return (
    <div data-b={element.id} className="b-shop-look flex flex-col gap-4" data-testid="builder-shop-look">
      {title && <h2 className="font-heading text-2xl font-extrabold text-sf-heading lg:text-3xl">{title}</h2>}
      <div
        className="relative"
        onKeyDown={(event) => {
          if (event.key === 'Escape' && open) {
            event.stopPropagation()
            close(true)
          }
        }}
      >
        <MediaImage media={image} alt={alt || image.alt || ''} sizes="(max-width: 1023px) 100vw, 60vw" className="block h-auto w-full rounded-sf-card" />
        {spots.map((spot) => {
          const expanded = open === spot.id
          const cardId = `${base}-${spot.id}`
          return (
            <div key={spot.id} className="absolute" style={{ left: `${spot.x}%`, top: `${spot.y}%` }}>
              <button
                type="button"
                data-look-dot
                ref={(node) => {
                  dots.current.set(spot.id, node)
                }}
                aria-label={t('content.builder.look.show', { name: spot.product.name })}
                aria-expanded={expanded}
                aria-controls={expanded ? cardId : undefined}
                onClick={() => setOpen(expanded ? null : spot.id)}
                // A 44 px target around an 28 px dot.
                className="group grid size-11 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full focus-visible:outline-3 focus-visible:outline-offset-0 focus-visible:outline-white"
              >
                <span aria-hidden className={cn('grid size-7 place-items-center rounded-full border-2 border-white bg-sf-heading/80 text-white shadow-lg transition group-hover:scale-110 motion-reduce:transition-none', expanded && 'bg-sf-accent text-sf-accent-foreground')}>
                  <PlusIcon className={cn('size-4 transition-transform motion-reduce:transition-none', expanded && 'rotate-45')} />
                </span>
              </button>
              {expanded && <LookCard id={cardId} product={spot.product} x={spot.x} y={spot.y} onClose={() => close(true)} />}
            </div>
          )
        })}
      </div>
      <section aria-label={t('content.builder.look.products')} className="md:hidden">
        <ul className="flex flex-col divide-y rounded-sf-card border bg-sf-surface">
          {spots.map((spot) => (
            <li key={spot.id}>
              <LookRow product={spot.product} />
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

function LookCard({ id, product, x, y, onClose }: { id: string; product: Card; x: number; y: number; onClose: () => void }) {
  const { t } = useLocale()
  const pricing = useCardPricing(product)
  const url = safeUrl(product.url) ?? '/shop'
  const nameId = useId()
  const cardRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    cardRef.current?.focus()
  }, [])

  return (
    <div
      ref={cardRef}
      id={id}
      role="dialog"
      aria-modal="false"
      aria-labelledby={nameId}
      tabIndex={-1}
      data-look-card
      data-testid="look-card"
      className={cn(
        'absolute z-20 flex w-60 flex-col gap-2 rounded-sf-card border bg-sf-surface p-3 text-left text-sf-text shadow-xl focus-visible:outline-2 focus-visible:outline-sf-accent',
        x > 50 ? 'right-6' : 'left-6',
        y > 55 ? 'bottom-6' : 'top-6',
      )}
    >
      <div className="flex items-start gap-3">
        <ProductImage image={product.image} alt={product.name} className="size-16 shrink-0 rounded-md border" />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <Link id={nameId} to={url} className="line-clamp-2 text-sm font-bold text-sf-heading hover:text-sf-accent hover:underline">
            {product.name}
          </Link>
          <CardPrice product={product} pricing={pricing} />
        </div>
        <button type="button" onClick={onClose} aria-label={t('content.builder.look.close', { name: product.name })} className="-mt-1 -mr-1 grid size-8 shrink-0 place-items-center rounded-full hover:bg-sf-canvas">
          <XIcon aria-hidden className="size-4" />
        </button>
      </div>
      <CardCartAction product={product} />
      <Link to={url} className="text-center text-xs font-semibold text-sf-link underline-offset-4 hover:underline">
        {t('content.builder.look.view')}
      </Link>
    </div>
  )
}

function LookRow({ product }: { product: Card }) {
  const pricing = useCardPricing(product)
  const url = safeUrl(product.url) ?? '/shop'
  return (
    <div className="flex items-center gap-3 p-3">
      <ProductImage image={product.image} alt="" className="size-14 shrink-0 rounded-md" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <Link to={url} className="truncate text-sm font-bold text-sf-heading hover:underline">
          {product.name}
        </Link>
        <CardPrice product={product} pricing={pricing} />
      </div>
      <div className="w-32 shrink-0">
        <CardCartAction product={product} />
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------------------------- */

/**
 * The products this visitor looked at before (this browser's recently-viewed list, the product
 * page's own storage), fetched fresh with current prices; nothing when the list is empty. On a
 * product page the product itself is left out. The editor canvas shows a labelled sample row.
 */
export function RecentlyViewedElement({ element }: { element: El<'recently_viewed'> }) {
  const { page } = usePage()
  const canvas = page.document?.key === 'canvas'
  return canvas ? <RecentSample element={element} /> : <RecentProducts element={element} />
}

function recentTitle(element: El<'recently_viewed'>): string {
  return str(element.props?.title).slice(0, B6_TEXT_LIMITS.recently_viewed.title).trim()
}

function RecentProducts({ element }: { element: El<'recently_viewed'> }) {
  const { t } = useLocale()
  const { slug: current } = useParams()
  const limit = boundedInt(element.props?.limit, B6_LIMITS.recentlyViewed.min, B6_LIMITS.recentlyViewed.max, 8)
  const [slugs] = useState(() => readRecentlyViewed().filter((slug) => slug !== current).slice(0, limit))
  const products = useProductsBySlugsQuery(slugs)
  const list = products.data ?? []
  const title = recentTitle(element) || t('catalog.product.recentlyViewed')
  if (list.length === 0) return slugs.length === 0 ? <DraftPlaceholder element={element} /> : null

  return (
    <section data-b={element.id} aria-label={title} className="b-recently-viewed" data-testid="builder-recently-viewed">
      <h2 className="mb-6 text-2xl font-extrabold lg:text-3xl">{title}</h2>
      <Rail label={title} count={list.length} itemClassName={PRODUCT_RAIL_ITEM}>
        {list.map((product) => (
          <ProductCard key={product.id} product={product} />
        ))}
      </Rail>
    </section>
  )
}

function RecentSample({ element }: { element: El<'recently_viewed'> }) {
  const { t } = useLocale()
  const limit = boundedInt(element.props?.limit, B6_LIMITS.recentlyViewed.min, B6_LIMITS.recentlyViewed.max, 8)
  const title = recentTitle(element) || t('catalog.product.recentlyViewed')
  return (
    <section data-b={element.id} aria-label={title} className="b-recently-viewed" data-testid="builder-recently-viewed" data-sample>
      <h2 className="mb-2 text-2xl font-extrabold lg:text-3xl">{title}</h2>
      <p className="mb-6 text-sm">{t('content.builder.recent.sample')}</p>
      <ul className="grid grid-cols-2 gap-5 md:grid-cols-4">
        {Array.from({ length: Math.min(limit, 4) }, (_, i) => (
          <li key={i} className="flex flex-col gap-2">
            <div aria-hidden className="aspect-square rounded-sf-card bg-sf-surface" />
            <p className="text-sm font-semibold text-sf-heading">{t('content.builder.recent.sampleName', { index: i + 1 })}</p>
            <div aria-hidden className="h-3 w-1/2 rounded bg-sf-surface" />
          </li>
        ))}
      </ul>
    </section>
  )
}
