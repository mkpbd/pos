import { useEffect, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { BuyForm } from '../cart/add-to-cart'
import { useBuyBox } from '../cart/buy-box'
import { isNotFound, useProductQuery, useProductsBySlugsQuery, useRelatedProductsQuery, type ProductPreview } from '../catalog/api'
import { ProductZone } from '../builder/zone'
import { Breadcrumbs } from '../catalog/breadcrumbs'
import { FrequentlyBought } from '../catalog/frequently-bought'
import { ProductBadges, ProductCard } from '../catalog/product-card'
import { ProductDetails, type DetailSection } from '../catalog/product-details'
import { ProductGallery } from '../catalog/product-gallery'
import { detailSectionId, useProductLayout } from '../catalog/product-layout'
import { PRODUCT_RAIL_ITEM, Rail } from '../catalog/product-rail'
import { ProductSummary } from '../catalog/product-summary'
import { QuickBuyBar } from '../catalog/quick-buy-bar'
import { readRecentlyViewed, recordRecentlyViewed } from '../catalog/recently-viewed'
import { useStickySummaryTop } from '../catalog/use-sticky-summary'
import { galleryPhotos, useProductGallery, useVariantSelection } from '../catalog/use-variant-selection'
import { REDUCED_MOTION_QUERY, useMediaQuery } from '../components/use-media-query'
import { usePromotionPricing } from '../promotions/display'
import { RichText } from '../components/rich-text'
import { QUESTIONS_TAB_ID, questionsTabLabel, REVIEWS_SECTION_ID, REVIEWS_TAB_ID, reviewsTabLabel } from '../reviews/display'
import { ProductQuestions } from '../reviews/product-questions'
import { ProductReviews, RatingSummaryLink } from '../reviews/product-reviews'
import { ShareBar } from '../social/share-bar'
import { WhatsAppOrderButton } from '../social/whatsapp'
import type { ProductCard as Card, ProductDetail, ProductVariant } from '../types'
import { WishlistButton } from '../wishlist/wishlist-button'
import { useDocumentMeta } from '../use-document-meta'
import { useLocale } from '../i18n/locale'
import { NotFoundPage } from './not-found-page'

const PREVIEW_STATES = {
  draft: 'catalog.preview.draft',
  scheduled: 'catalog.preview.scheduled',
  expired: 'catalog.preview.expired',
} as const

export function ProductPage() {
  const { slug = '' } = useParams()
  return <ProductPageContent key={slug} slug={slug} />
}

function ProductPageContent({ slug }: { slug: string }) {
  const [params] = useSearchParams()
  // Staff previews: `?preview=1` opens an unpublished listing, `?preview=draft` (P1b) also shows builder zone drafts.
  const previewParam = params.get('preview')
  const preview: ProductPreview = previewParam === 'draft' ? 'draft' : previewParam === '1'
  const product = useProductQuery(slug, preview)
  const data = product.data
  const { t } = useLocale()

  // Canonical without ?variant= (one URL per product); previews are never indexed.
  useDocumentMeta(
    data
      ? {
          title: data.seo.title || data.name,
          description: data.seo.description || data.short_description,
          image: data.seo.image_url ?? data.images[0]?.url,
          canonical: data.url,
          type: 'product',
          noindex: Boolean(preview) || Boolean(data.preview_state),
        }
      : null,
  )

  useEffect(() => {
    if (data && !data.preview_state) recordRecentlyViewed(data.slug)
  }, [data])

  if (isNotFound(product.error)) return <NotFoundPage />
  if (product.error) {
    return (
      <section className="mx-auto max-w-sf px-4 py-16 text-center">
        <h1 className="text-2xl font-bold">{t('catalog.product.loadFailed')}</h1>
        <Button className="mt-4 h-11 rounded-sf-button px-6" onClick={() => void product.refetch()}>{t('common.tryAgain')}</Button>
      </section>
    )
  }
  if (!data) {
    return (
      <div role="status" className="grid min-h-[50vh] place-items-center">
        <span className="size-10 animate-spin rounded-full border-4 border-sf-border border-t-sf-accent" aria-hidden />
        <span className="sr-only">{t('catalog.product.loading')}</span>
      </div>
    )
  }

  return <ProductView product={data} />
}

/**
 * The product page. P1b: the theme's product layout (gallery side, thumbnail position, sticky
 * summary, details as tabs, accordion or stacked), "Buy now" next to "Add to cart" with a quick-buy
 * bar once the buy area scrolls away, the delivery note and the `product.below_price` zone under the
 * price, questions & answers next to the reviews, "Frequently bought together" to add in one go, and
 * the `product.after` / `product.bottom` zones — each resolved by the server for this product.
 * P2b: "Order on WhatsApp" under "Buy now" and the share bar at the end of the summary.
 */
function ProductView({ product }: { product: ProductDetail }) {
  const [params, setParams] = useSearchParams()
  const variantParam = params.get('variant')

  const { selection, variant, choose: pick } = useVariantSelection(product, variantParam, (next) => {
    setParams(
      (current) => {
        const updated = new URLSearchParams(current)
        if (next) updated.set('variant', next.id)
        else updated.delete('variant')
        return updated
      },
      { replace: true },
    )
  })
  // The variant from the URL shows its own image first; its colour's photos when it has them (P1a).
  const gallery = useProductGallery(product, selection, variant)
  const choose = (optionName: string, value: string) => {
    const next = pick(optionName, value)
    gallery.follow(next.variant, next.selection)
  }
  const promo = usePromotionPricing(product, variant)
  const layout = useProductLayout()
  const box = useBuyBox(product, variant)
  // The detail part shown (tabs) or asked for (`request` counts the asks: the rating link opens the reviews each time).
  const [section, setSection] = useState<{ id?: string; request: number }>({ request: 0 })
  const { t } = useLocale()
  const reducedMotion = useMediaQuery(REDUCED_MOTION_QUERY)
  const pageRef = useRef<HTMLElement>(null)
  const buyRef = useRef<HTMLDivElement>(null)
  const summaryRef = useRef<HTMLDivElement>(null)
  const stickyTop = useStickySummaryTop(summaryRef, layout.sticky_summary)
  const behavior: ScrollBehavior = reducedMotion ? 'auto' : 'smooth'

  const openSection = (id: string) => {
    setSection((current) => ({ id, request: current.request + 1 }))
    const target = layout.details === 'tabs' ? document.getElementById(REVIEWS_SECTION_ID) : document.getElementById(detailSectionId(id))
    target?.scrollIntoView?.({ behavior, block: 'start' })
  }

  /** The quick-buy bar and "Frequently bought together" send the shopper to the first option still to choose. */
  const chooseOptions = () => {
    const selector = pageRef.current?.querySelector<HTMLElement>('[data-testid="variant-selector"]')
    if (!selector) return buyRef.current?.scrollIntoView?.({ behavior, block: 'center' })
    const missing = Math.max(0, product.options.findIndex((option) => selection[option.name] === undefined))
    const group = selector.children[missing] ?? selector
    group.querySelector<HTMLElement>('input:not([disabled]), select')?.focus({ preventScroll: true })
    group.scrollIntoView?.({ behavior, block: 'center' })
  }

  /** The bar's "Notify me" for a sold-out variant: the back-in-stock form in the buy area. */
  const notify = () => {
    buyRef.current?.querySelector<HTMLElement>('[data-testid="notify-me"] button')?.focus({ preventScroll: true })
    buyRef.current?.scrollIntoView?.({ behavior, block: 'center' })
  }

  const sections: DetailSection[] = []
  if (product.description_html) sections.push({ id: 'description', label: t('catalog.product.description'), content: <RichText html={product.description_html} className="max-w-3xl" /> })
  if (product.specifications.length > 0) {
    sections.push({
      id: 'specifications',
      label: t('catalog.product.specifications'),
      content: (
        <table className="w-full max-w-2xl text-sm">
          <tbody>
            {product.specifications.map((spec, i) => (
              <tr key={`${spec.label}-${i}`} className="border-b last:border-b-0">
                <th scope="row" className="w-1/3 py-2.5 pr-4 text-left align-top font-semibold text-sf-heading">{spec.label}</th>
                <td className="py-2.5">{spec.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ),
    })
  }
  if (!product.preview_state) {
    sections.push({ id: REVIEWS_TAB_ID, label: reviewsTabLabel(product.rating, t), content: <ProductReviews slug={product.slug} /> })
    // P1b: only stores whose catalog reports questions (the count) have the questions & answers part.
    if (typeof product.questions_count === 'number') {
      sections.push({ id: QUESTIONS_TAB_ID, label: questionsTabLabel(product.questions_count, t), content: <ProductQuestions product={product} /> })
    }
  }

  const previewKey = product.preview_state ? PREVIEW_STATES[product.preview_state as keyof typeof PREVIEW_STATES] : undefined
  const notice = previewKey ? t(previewKey) : undefined
  const barImage = gallery.images[gallery.index] ?? product.images[0] ?? null

  return (
    <article ref={pageRef} data-testid="product-page" data-gallery={layout.gallery} data-details={layout.details}>
      {notice && (
        <p role="status" className="bg-neutral-900 px-4 py-1.5 text-center text-xs font-semibold text-white">
          {notice}
        </p>
      )}
      <div className="bg-sf-surface">
        <div className="mx-auto max-w-sf px-4 py-5">
          <Breadcrumbs items={product.breadcrumbs} />
        </div>
      </div>

      <div className="mx-auto max-w-sf px-4 pt-8">
        <div className={cn('grid gap-8 rounded-sf-card bg-sf-surface p-4 md:grid-cols-2 md:p-8 lg:gap-12', layout.sticky_summary && 'md:items-start')}>
          <div className={cn('relative min-w-0', layout.gallery === 'right' && 'md:order-last')}>
            <ProductGallery
              images={gallery.images}
              name={product.name}
              index={gallery.index}
              onIndexChange={gallery.setIndex}
              photos={galleryPhotos(product, gallery)}
              video={gallery.video}
              thumbnails={layout.thumbnails}
              overlay={
                <ProductBadges
                  onSale={variant ? variant.on_sale : product.on_sale}
                  discountPercent={null}
                  isNew={product.is_new}
                  inStock={variant ? variant.in_stock : product.in_stock}
                  promotionLabel={promo?.label}
                  custom={product.badges}
                  className="absolute top-3 left-3 max-w-[calc(100%-1.5rem)]"
                />
              }
            />
          </div>
          <div
            ref={summaryRef}
            className={cn('flex min-w-0 flex-col gap-5', layout.sticky_summary && 'md:sticky md:self-start')}
            style={stickyTop === null ? undefined : { top: `calc(var(--sf-popup-bar-top, 0px) + ${stickyTop}px)` }}
            data-testid="product-summary"
          >
            <div className="flex flex-col gap-2">
              <h1 className="text-3xl leading-tight font-extrabold lg:text-4xl">{product.name}</h1>
              <RatingSummaryLink rating={product.rating} onOpen={() => openSection(REVIEWS_TAB_ID)} />
            </div>
            <ProductSummary
              product={product}
              variant={variant}
              selection={selection}
              onChoose={choose}
              belowPrice={<ProductZone zone="product.below_price" product={product} inline />}
            />
            <div ref={buyRef} className="flex flex-col gap-3 border-t pt-5" data-testid="buy-area">
              <BuyForm
                key={variant?.id ?? 'none'}
                product={product}
                variant={variant}
                box={box}
                buyNow
                extra={<WhatsAppOrderButton product={product} variant={variant} quantity={box.quantity} />}
              />
              <WishlistButton product={product} name={product.name} appearance="text" />
            </div>
            {product.category?.slug && (
              <p className="border-t pt-4 text-sm">
                {t('catalog.product.category')}{' '}
                <Link to={`/category/${product.category.slug}`} className="font-semibold text-sf-link hover:underline">
                  {product.category.name}
                </Link>
              </p>
            )}
            {/* P2b: never for a staff preview (its address is not for sharing). */}
            {!product.preview_state && (
              <ShareBar
                target={{ url: product.url, title: product.name, image: product.seo.image_url ?? product.images[0]?.url ?? null }}
                label={t('social.share.product')}
                className={product.category?.slug ? undefined : 'border-t pt-4'}
              />
            )}
          </div>
        </div>

        {sections.length > 0 && (
          <section id={REVIEWS_SECTION_ID} aria-label={t('catalog.product.information')} className="mt-8 scroll-mt-24 rounded-sf-card bg-sf-surface p-4 md:p-8">
            <ProductDetails
              sections={sections}
              mode={layout.details}
              label={t('catalog.product.information')}
              active={section.id}
              request={section.request}
              onActivate={(id) => setSection((current) => ({ ...current, id }))}
            />
          </section>
        )}
      </div>

      {/* B4: the store builder's "after the details" zone, full width below the details and tabs. */}
      <ProductZone zone="product.after" product={product} />

      <div className="mx-auto max-w-sf px-4 pb-8">
        <RelatedSections product={product} variant={variant} onChooseOptions={chooseOptions} />
        <RecentlyViewed currentSlug={product.slug} />
      </div>

      {/* P1b: the very end of the product page. */}
      <ProductZone zone="product.bottom" product={product} />

      <QuickBuyBar product={product} variant={variant} box={box} image={barImage} watch={buyRef} onChooseOptions={chooseOptions} onNotify={notify} />
    </article>
  )
}

function ProductRow({ title, products }: { title: string; products: Card[] }) {
  if (products.length === 0) return null

  return (
    <section className="mt-12" aria-label={title}>
      <h2 className="mb-6 text-2xl font-extrabold lg:text-3xl">{title}</h2>
      <Rail label={title} count={products.length} itemClassName={PRODUCT_RAIL_ITEM}>
        {products.map((p) => (
          <ProductCard key={p.id} product={p} />
        ))}
      </Rail>
    </section>
  )
}

/** "Frequently bought together" (P1b: hand-picked, else from co-purchases) and the related products (hand-picked, else same category / brand). */
function RelatedSections({ product, variant, onChooseOptions }: { product: ProductDetail; variant: ProductVariant | null; onChooseOptions: () => void }) {
  const related = useRelatedProductsQuery(product.slug)
  const { t } = useLocale()
  if (!related.data) return null

  return (
    <>
      <FrequentlyBought
        product={product}
        variant={variant}
        cards={Array.isArray(related.data.frequently_bought) ? related.data.frequently_bought : []}
        source={related.data.frequently_bought_source ?? null}
        onChooseOptions={onChooseOptions}
      />
      <ProductRow title={t('catalog.product.related')} products={Array.isArray(related.data.related) ? related.data.related : []} />
    </>
  )
}

/** Up to eight products this visitor looked at before, fetched fresh (current prices). */
function RecentlyViewed({ currentSlug }: { currentSlug: string }) {
  const [slugs] = useState(() => readRecentlyViewed().filter((s) => s !== currentSlug).slice(0, 8))
  const products = useProductsBySlugsQuery(slugs)
  const { t } = useLocale()

  return <ProductRow title={t('catalog.product.recentlyViewed')} products={products.data ?? []} />
}
