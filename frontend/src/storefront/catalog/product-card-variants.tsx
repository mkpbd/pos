import { Link } from 'react-router'
import { EyeIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { CardCartAction } from '../cart/add-to-cart'
import { useLocale } from '../i18n/locale'
import { Countdown } from '../promotions/countdown-timer'
import { WishlistButton } from '../wishlist/wishlist-button'
import { customBadgesOf } from './badge-colors'
import { CardPrice, CardRating, CardSwatchRow } from './card-parts'
import { useCardSwatches } from './card-swatches'
import { useCardPricing } from './card-pricing'
import { CustomBadgeItems } from './custom-badges'
import type { ProductCardProps } from './product-card'
import { ProductImage } from './product-image'
import { useQuickView } from './quick-view-context'

/**
 * Minimal card (handmade): image-led with a taller image, name and price ("From ৳X" for variable
 * prices), a "−N %" label when reduced, no buttons. The name link covers the whole card; the image
 * zooms gently on hover. `actions` (e.g. the wishlist page's) sit above the link.
 */
export function MinimalProductCard({ product, eager = false, actions }: ProductCardProps) {
  const { t } = useLocale()
  const pricing = useCardPricing(product)
  const swatch = useCardSwatches(product)
  const discount = pricing.promotionLabel ?? (product.on_sale && product.discount_percent ? t('catalog.badges.discount', { percent: product.discount_percent }) : null)

  return (
    <article
      className="group relative flex h-full flex-col rounded-sf-card has-[a:focus-visible]:outline-2 has-[a:focus-visible]:outline-offset-4 has-[a:focus-visible]:outline-sf-accent"
      data-testid="product-card"
      data-card-style="minimal"
    >
      <div className="relative overflow-hidden rounded-sf-card bg-sf-canvas">
        <div aria-hidden>
          <ProductImage
            image={swatch.image}
            alt=""
            eager={eager}
            fit="cover"
            className="aspect-[4/5] bg-sf-canvas"
            imgClassName="transition-transform duration-700 ease-out group-hover:scale-[1.04] motion-reduce:transition-none"
          />
        </div>
        {(discount || !product.in_stock || customBadgesOf(product.badges).length > 0) && (
          <ul className="pointer-events-none absolute top-3 left-3 flex max-w-[calc(100%-1.5rem)] flex-col items-start gap-1.5" aria-label={t('catalog.badges.label')}>
            {discount && (
              <li className="rounded-sf-button bg-sf-sale px-2.5 py-1 text-xs font-semibold tracking-wide text-white" data-testid="discount-badge">
                {pricing.promotionLabel && <span className="sr-only">{t('catalog.badges.offer')}</span>}
                {discount}
              </li>
            )}
            {!product.in_stock && <li className="rounded-sf-button bg-sf-surface/90 px-2.5 py-1 text-xs font-semibold tracking-wide text-sf-heading">{t('catalog.stock.out')}</li>}
            <CustomBadgeItems badges={product.badges} className="rounded-sf-button px-2.5 py-1 text-xs font-semibold tracking-wide" />
          </ul>
        )}
      </div>

      <div className="flex flex-1 flex-col items-center gap-1.5 px-2 pt-4 text-center">
        <h3 className="text-lg leading-snug font-normal">
          <Link to={product.url} className="line-clamp-2 transition-colors after:absolute after:inset-0 hover:text-sf-accent focus-visible:outline-none">
            {product.name}
          </Link>
        </h3>
        <CardPrice product={product} pricing={pricing} from className="justify-center [&_[data-testid=price]]:font-medium" />
        <CardSwatchRow {...swatch.row} className="justify-center" />
        {actions && <div className="relative z-10 w-full pt-2">{actions}</div>}
      </div>
    </article>
  )
}

/**
 * Commerce card (classic): dense, the second image on hover, wishlist and quick view sliding in on
 * hover or keyboard focus (always visible on touch screens), category label, stars with the review
 * count, price with the struck original, Sale / New / Out of stock badges and a filled add-to-cart.
 */
export function CommerceProductCard({ product, eager = false, actions, countdown = true }: ProductCardProps) {
  const quickView = useQuickView()
  const { t } = useLocale()
  const pricing = useCardPricing(product)
  const swatch = useCardSwatches(product)
  const { promotion, promotionLabel } = pricing
  const saleLabel = promotionLabel ?? (product.on_sale ? (product.discount_percent ? t('catalog.badges.discount', { percent: product.discount_percent }) : t('catalog.badges.sale')) : null)
  const badge = 'rounded-sm px-2 py-1 text-[0.7rem] leading-none font-bold tracking-wide text-white uppercase'
  const hoverReveal =
    '[@media(hover:hover)]:translate-x-3 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:translate-x-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:group-focus-within:translate-x-0 [@media(hover:hover)]:group-focus-within:opacity-100'

  return (
    <article
      className="group relative flex h-full flex-col overflow-hidden rounded-sf-card border border-transparent bg-sf-surface transition hover:border-sf-border hover:shadow-xl focus-within:border-sf-border focus-within:shadow-xl"
      data-testid="product-card"
      data-card-style="commerce"
    >
      <div className="relative">
        <Link to={product.url} tabIndex={-1} aria-hidden className="block overflow-hidden">
          <ProductImage
            image={swatch.image}
            alt={product.name}
            eager={eager}
            fit="cover"
            className="aspect-[3/4]"
            imgClassName={cn('transition duration-500 motion-reduce:transition-none', product.hover_image && !swatch.swapped ? 'group-hover:opacity-0' : 'group-hover:scale-105')}
          />
          {product.hover_image && !swatch.swapped && (
            <ProductImage
              image={product.hover_image}
              alt=""
              fit="cover"
              className="absolute inset-0 aspect-[3/4] opacity-0 transition-opacity duration-500 group-hover:opacity-100 motion-reduce:transition-none"
            />
          )}
        </Link>

        {(saleLabel || product.is_new || !product.in_stock || customBadgesOf(product.badges).length > 0) && (
          <ul className="pointer-events-none absolute top-2.5 left-2.5 flex max-w-[calc(100%-4rem)] flex-col items-start gap-1" aria-label={t('catalog.badges.label')}>
            {saleLabel && (
              <li className={cn(badge, 'bg-sf-sale')} data-testid="sale-badge">
                {promotionLabel && <span className="sr-only">{t('catalog.badges.offer')}</span>}
                {saleLabel}
              </li>
            )}
            {product.is_new && <li className={cn(badge, 'bg-sf-highlight')}>{t('catalog.badges.new')}</li>}
            {!product.in_stock && <li className={cn(badge, 'bg-sf-heading')}>{t('catalog.stock.out')}</li>}
            <CustomBadgeItems badges={product.badges} className="rounded-sm px-2 py-1 text-[0.7rem] leading-none font-bold tracking-wide uppercase" />
          </ul>
        )}
        {countdown && promotion?.show_countdown && <Countdown endsAt={promotion.ends_at} variant="chip" prefix="" className="absolute bottom-2.5 left-2.5" />}

        <div className={cn('absolute top-2.5 right-2.5 flex flex-col gap-2 transition duration-300 motion-reduce:transition-none', hoverReveal)} data-testid="card-hover-actions">
          <WishlistButton product={product} name={product.name} className="size-9 rounded-sf-button" />
          {quickView && (
            <button
              type="button"
              onClick={() => quickView.open(product.slug)}
              aria-label={t('catalog.card.quickView', { name: product.name })}
              className="grid size-9 place-items-center rounded-sf-button bg-sf-surface text-sf-heading shadow-md transition hover:bg-sf-accent hover:text-sf-accent-foreground focus-visible:bg-sf-accent focus-visible:text-sf-accent-foreground"
            >
              <EyeIcon aria-hidden className="size-4" />
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-1 px-3 pt-3 pb-4">
        {product.category && <p className="text-[0.7rem] font-semibold tracking-wider text-sf-text uppercase">{product.category.name}</p>}
        <h3 className="font-sans text-[0.95rem] leading-snug font-semibold">
          <Link to={product.url} className="line-clamp-2 transition-colors hover:text-sf-accent focus-visible:text-sf-accent">
            {product.name}
          </Link>
        </h3>
        <CardRating rating={product.rating} />
        <CardSwatchRow {...swatch.row} />
        <CardPrice product={product} pricing={pricing} className="mt-auto pt-1" />
        <div className="pt-3">{actions ?? <CardCartAction product={product} appearance="solid" />}</div>
      </div>
    </article>
  )
}
