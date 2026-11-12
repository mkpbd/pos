import { Link } from 'react-router'
import { EyeIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { CardCartAction } from '../cart/add-to-cart'
import { useLocale } from '../i18n/locale'
import { Countdown } from '../promotions/countdown-timer'
import { WishlistButton } from '../wishlist/wishlist-button'
import { CardPrice } from './card-parts'
import { useCardPricing } from './card-pricing'
import type { ProductCardProps } from './product-card'
import { ProductImage } from './product-image'
import { useQuickView } from './quick-view-context'

/*
 * The caption block's colours: the primary pair at rest, the accent pair while the card is hovered or
 * holds the focus. Text always uses the pair's foreground, so it keeps the theme's AA contrast.
 */
const BLOCK_COLORS =
  'bg-sf-primary text-sf-primary-foreground group-hover:bg-sf-accent group-hover:text-sf-accent-foreground group-focus-within:bg-sf-accent group-focus-within:text-sf-accent-foreground'
const ARCH_COLORS = 'text-sf-primary group-hover:text-sf-accent group-focus-within:text-sf-accent'
const COLOR_TRANSITION = 'transition-colors duration-300 motion-reduce:transition-none'

/*
 * Where the actions sit. On screens with a pointer that hovers they float: the cart on top of the
 * arch, wishlist and quick view on the image's right; hidden until the card is hovered or focused
 * (keyboard users reveal them by tabbing in). On touch screens they form a row under the price.
 */
const FLOAT_ROW = 'flex flex-wrap items-center justify-center gap-1.5 px-2 pb-4 [@media(hover:hover)]:contents'
const FLOAT_SIDE =
  'flex items-center gap-1.5 transition duration-300 motion-reduce:transition-none [@media(hover:hover)]:absolute [@media(hover:hover)]:right-3 [@media(hover:hover)]:bottom-[calc(100%+2.25rem)] [@media(hover:hover)]:z-10 [@media(hover:hover)]:flex-col [@media(hover:hover)]:gap-2 [@media(hover:hover)]:translate-x-4 [@media(hover:hover)]:opacity-0 group-hover:translate-x-0 group-hover:opacity-100 [@media(hover:hover)]:group-focus-within:translate-x-0 [@media(hover:hover)]:group-focus-within:opacity-100'
const FLOAT_CART =
  'transition duration-300 motion-reduce:transition-none [@media(hover:hover)]:absolute [@media(hover:hover)]:-top-6 [@media(hover:hover)]:left-1/2 [@media(hover:hover)]:z-10 [@media(hover:hover)]:-translate-x-1/2 [@media(hover:hover)]:-translate-y-1/2 [@media(hover:hover)]:scale-75 [@media(hover:hover)]:opacity-0 group-hover:scale-100 group-hover:opacity-100 [@media(hover:hover)]:group-focus-within:scale-100 [@media(hover:hover)]:group-focus-within:opacity-100'

/**
 * Arched card (kids): a white image area, a diagonal sale ribbon in the top-left corner and a
 * coloured caption block with an arched top edge holding the name, category and price. Hovering or
 * focusing the card turns the block to the accent colour and reveals a round add-to-cart button on
 * the arch plus wishlist and quick view at the image's right; touch screens show them as a row.
 * `actions` (e.g. the wishlist page's) replace the cart button, on a white strip under the block.
 */
export function ArchedProductCard({ product, eager = false, actions, countdown = true }: ProductCardProps) {
  const quickView = useQuickView()
  const { t } = useLocale()
  const pricing = useCardPricing(product)
  const { promotion, promotionLabel } = pricing
  const ribbon = promotionLabel ?? (product.on_sale ? (product.discount_percent ? t('catalog.badges.discount', { percent: product.discount_percent }) : t('catalog.badges.sale')) : null)
  const badge = 'rounded-full px-2.5 py-0.5 text-xs font-bold text-white'

  return (
    <article
      className="group relative flex h-full flex-col overflow-hidden rounded-sf-card bg-sf-surface shadow-sm transition-shadow duration-300 hover:shadow-lg focus-within:shadow-lg motion-reduce:transition-none"
      data-testid="product-card"
      data-card-style="arched"
    >
      <div className="relative">
        <Link to={product.url} tabIndex={-1} aria-hidden className="block overflow-hidden">
          <ProductImage
            image={product.image}
            alt={product.name}
            eager={eager}
            fit="cover"
            imgClassName={cn('transition duration-500 motion-reduce:transition-none', product.hover_image ? 'group-hover:opacity-0' : 'group-hover:scale-105')}
          />
          {product.hover_image && (
            <ProductImage
              image={product.hover_image}
              alt=""
              fit="cover"
              className="absolute inset-0 opacity-0 transition-opacity duration-500 group-hover:opacity-100 motion-reduce:transition-none"
            />
          )}
        </Link>

        {(ribbon || product.is_new || !product.in_stock) && (
          <ul className="pointer-events-none absolute inset-0" aria-label={t('catalog.badges.label')}>
            {ribbon && (
              // A band across the top-left corner; the box clips its ends.
              <li className="absolute top-0 left-0 size-24 overflow-hidden" data-testid="sale-ribbon">
                <span className="absolute top-6 -left-9 block w-36 -rotate-45 bg-sf-sale py-1 text-center text-xs font-bold tracking-wide text-white shadow-md">
                  {promotionLabel && <span className="sr-only">{t('catalog.badges.offer')}</span>}
                  {ribbon}
                </span>
              </li>
            )}
            {product.is_new && <li className={cn(badge, 'absolute top-3 right-3 bg-sf-highlight')}>{t('catalog.badges.new')}</li>}
            {!product.in_stock && <li className={cn(badge, 'absolute right-3 bg-sf-heading', product.is_new ? 'top-10' : 'top-3')}>{t('catalog.stock.out')}</li>}
          </ul>
        )}
        {countdown && promotion?.show_countdown && <Countdown endsAt={promotion.ends_at} variant="chip" prefix="" className="absolute bottom-9 left-3" />}
      </div>

      <div className={cn('relative flex flex-1 flex-col', BLOCK_COLORS, COLOR_TRANSITION)} data-testid="arched-caption">
        {/* The arch: the block's colour bulging up over the bottom of the image. */}
        <svg aria-hidden viewBox="0 0 100 16" preserveAspectRatio="none" className={cn('pointer-events-none absolute inset-x-0 bottom-[calc(100%-1px)] h-6 w-full', ARCH_COLORS, COLOR_TRANSITION)} data-testid="card-arch">
          <path d="M0 16C18 0 82 0 100 16Z" fill="currentColor" />
        </svg>

        <div className="flex flex-1 flex-col items-center gap-1 px-4 pt-3 pb-5 text-center">
          <h3 className="font-heading text-base leading-snug font-bold tracking-wide text-inherit uppercase">
            <Link to={product.url} className="line-clamp-2 underline-offset-4 hover:underline focus-visible:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current">
              {product.name}
            </Link>
          </h3>
          {product.category && <p className="text-xs font-medium">{product.category.name}</p>}
          <CardPrice
            product={product}
            pricing={pricing}
            className="mt-auto justify-center pt-1 [&_[data-testid=compare-price]]:text-current [&_[data-testid=price]]:text-current"
          />
        </div>

        {actions ? (
          <div className="bg-sf-surface px-3 pt-3 pb-4 text-sf-text">{actions}</div>
        ) : (
          <div className={FLOAT_ROW} data-testid="card-actions">
            <CardCartAction product={product} appearance="round" className={FLOAT_CART} />
            <div className={FLOAT_SIDE} data-testid="card-hover-actions">
              <WishlistButton product={product} name={product.name} className="size-10 [@media(hover:hover)]:size-11" />
              {quickView && (
                <button
                  type="button"
                  onClick={() => quickView.open(product.slug)}
                  aria-label={t('catalog.card.quickView', { name: product.name })}
                  className="grid size-10 place-items-center rounded-full bg-sf-surface text-sf-heading shadow-md transition hover:bg-sf-accent hover:text-sf-accent-foreground focus-visible:bg-sf-accent focus-visible:text-sf-accent-foreground [@media(hover:hover)]:size-11"
                >
                  <EyeIcon aria-hidden className="size-5" />
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </article>
  )
}
