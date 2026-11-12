import { useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { Button } from '@/components/ui/button'
import { AddToCartForm } from '../cart/add-to-cart'
import { isNotFound, useProductQuery, useProductsBySlugsQuery, useRelatedProductsQuery } from '../catalog/api'
import { BuilderZone } from '../builder/zone'
import { Breadcrumbs } from '../catalog/breadcrumbs'
import { ProductBadges, ProductCard } from '../catalog/product-card'
import { ProductGallery } from '../catalog/product-gallery'
import { PRODUCT_RAIL_ITEM, Rail } from '../catalog/product-rail'
import { ProductSummary } from '../catalog/product-summary'
import { Tabs, type TabItem } from '../catalog/product-tabs'
import { readRecentlyViewed, recordRecentlyViewed } from '../catalog/recently-viewed'
import { imageIndexOf, useVariantSelection } from '../catalog/use-variant-selection'
import { initialVariant } from '../catalog/variant-selection'
import { usePromotionPricing } from '../promotions/display'
import { RichText } from '../components/rich-text'
import { REVIEWS_SECTION_ID, REVIEWS_TAB_ID, reviewsTabLabel } from '../reviews/display'
import { ProductReviews, RatingSummaryLink } from '../reviews/product-reviews'
import type { ProductCard as Card, ProductDetail } from '../types'
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
  const preview = params.get('preview') === '1'
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
          noindex: preview || Boolean(data.preview_state),
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

function ProductView({ product }: { product: ProductDetail }) {
  const [params, setParams] = useSearchParams()
  const variantParam = params.get('variant')
  // The variant from the URL shows its own image first.
  const [imageIndex, setImageIndex] = useState(() => Math.max(0, imageIndexOf(product, initialVariant(product, variantParam)?.image_id)))

  const { selection, variant, choose } = useVariantSelection(product, variantParam, (next) => {
    setParams(
      (current) => {
        const updated = new URLSearchParams(current)
        if (next) updated.set('variant', next.id)
        else updated.delete('variant')
        return updated
      },
      { replace: true },
    )
    const i = imageIndexOf(product, next?.image_id)
    if (i >= 0) setImageIndex(i)
  })
  const promo = usePromotionPricing(product, variant)
  const [tab, setTab] = useState<string | undefined>(undefined)
  const { t } = useLocale()

  const openReviews = () => {
    setTab(REVIEWS_TAB_ID)
    document.getElementById(REVIEWS_SECTION_ID)?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
  }

  const tabs: TabItem[] = []
  if (product.description_html) tabs.push({ id: 'description', label: t('catalog.product.description'), content: <RichText html={product.description_html} className="max-w-3xl" /> })
  if (product.specifications.length > 0) {
    tabs.push({
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

  if (!product.preview_state) tabs.push({ id: REVIEWS_TAB_ID, label: reviewsTabLabel(product.rating, t), content: <ProductReviews slug={product.slug} /> })

  const previewKey = product.preview_state ? PREVIEW_STATES[product.preview_state as keyof typeof PREVIEW_STATES] : undefined
  const notice = previewKey ? t(previewKey) : undefined

  return (
    <article data-testid="product-page">
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
        <div className="grid gap-8 rounded-sf-card bg-sf-surface p-4 md:grid-cols-2 md:p-8 lg:gap-12">
          <div className="relative">
            <ProductGallery images={product.images} name={product.name} index={imageIndex} onIndexChange={setImageIndex} />
            <ProductBadges
              onSale={variant ? variant.on_sale : product.on_sale}
              discountPercent={null}
              isNew={product.is_new}
              inStock={variant ? variant.in_stock : product.in_stock}
              promotionLabel={promo?.label}
              className="absolute top-3 left-3"
            />
          </div>
          <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-2">
              <h1 className="text-3xl leading-tight font-extrabold lg:text-4xl">{product.name}</h1>
              <RatingSummaryLink rating={product.rating} onOpen={openReviews} />
            </div>
            <ProductSummary product={product} variant={variant} selection={selection} onChoose={choose} />
            <div className="flex flex-col gap-3 border-t pt-5">
              <AddToCartForm key={variant?.id ?? 'none'} product={product} variant={variant} />
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
          </div>
        </div>

        {tabs.length > 0 && (
          <section id={REVIEWS_SECTION_ID} aria-label={t('catalog.product.information')} className="mt-8 scroll-mt-24 rounded-sf-card bg-sf-surface p-4 md:p-8">
            <Tabs tabs={tabs} label={t('catalog.product.information')} selectedId={tab} onSelect={setTab} />
          </section>
        )}
      </div>

      {/* B4: the store builder's "product page" zone, full width below the details and tabs. */}
      <BuilderZone zone="product.after" />

      <div className="mx-auto max-w-sf px-4 pb-8">
        <RelatedSections slug={product.slug} />
        <RecentlyViewed currentSlug={product.slug} />
      </div>
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

function RelatedSections({ slug }: { slug: string }) {
  const related = useRelatedProductsQuery(slug)
  const { t } = useLocale()
  if (!related.data) return null

  return (
    <>
      <ProductRow title={t('catalog.product.frequentlyBought')} products={related.data.frequently_bought} />
      <ProductRow title={t('catalog.product.related')} products={related.data.related} />
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
