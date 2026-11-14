import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { EyeIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { CardCartAction } from '../cart/add-to-cart'
import { useLocale } from '../i18n/locale'
import { Countdown } from '../promotions/countdown-timer'
import { useStoreLayout } from '../theme'
import type { ProductCard as Card } from '../types'
import { WishlistButton } from '../wishlist/wishlist-button'
import { Price } from './price'
import { ProductImage } from './product-image'
import { useQuickView } from './quick-view-context'
import { CardRating, CardSwatchRow, ProductBadges } from './card-parts'
import { useCardSwatches } from './card-swatches'
import { useCardPricing } from './card-pricing'
import { ArchedProductCard } from './arched-product-card'
import { CommerceProductCard, MinimalProductCard } from './product-card-variants'

export { CardRating, ProductBadges } from './card-parts'

export type ProductCardProps = {
  product: Card
  layout?: 'grid' | 'list'
  eager?: boolean
  actions?: ReactNode
  /** Show a flash sale's countdown chip (off where the section shows the same countdown). */
  countdown?: boolean
}

/**
 * A product in a grid, carousel or list, in the theme's `card_style`: `minimal` (image-led, no
 * buttons), `commerce` (dense, hover actions) and `arched` (coloured arched caption, round hover
 * actions) for grids; the list view always uses the standard card.
 */
export function ProductCard(props: ProductCardProps) {
  const { card_style: style } = useStoreLayout()
  if (props.layout !== 'list' && style === 'minimal') return <MinimalProductCard {...props} />
  if (props.layout !== 'list' && style === 'commerce') return <CommerceProductCard {...props} />
  if (props.layout !== 'list' && style === 'arched') return <ArchedProductCard {...props} />
  return <StandardProductCard {...props} />
}

/**
 * The standard card: image (second image on hover), badges, brand,
 * name, price (range when the variants differ), wishlist heart, quick view button and the
 * buy action (add to cart for single-variant products, else a link to choose options). Hover-only parts
 * also show on keyboard focus, and the quick view button is always visible on touch screens.
 */
function StandardProductCard({
  product,
  layout = 'grid',
  eager = false,
  actions,
  countdown = true,
}: ProductCardProps) {
  const quickView = useQuickView()
  const { t } = useLocale()
  const { promotion, range, priceMax, compareAt, promoPrice, promotionLabel } = useCardPricing(product)
  const swatch = useCardSwatches(product)

  return (
    <article
      className={cn(
        'group relative flex h-full overflow-hidden rounded-sf-card border bg-sf-surface transition-shadow hover:shadow-lg focus-within:shadow-lg',
        layout === 'grid' ? 'flex-col' : 'flex-col sm:flex-row',
      )}
      data-testid="product-card"
    >
      <div className={cn('relative shrink-0', layout === 'list' && 'sm:w-56')}>
        <Link to={product.url} tabIndex={-1} aria-hidden className="block">
          <ProductImage image={swatch.image} alt={product.name} eager={eager} imgClassName="transition-transform duration-500 group-hover:scale-105 motion-reduce:transition-none" />
          {product.hover_image && !swatch.swapped && (
            <ProductImage
              image={product.hover_image}
              alt={product.name}
              className="absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
            />
          )}
        </Link>
        <ProductBadges
          onSale={product.on_sale}
          discountPercent={product.discount_percent}
          isNew={product.is_new}
          inStock={product.in_stock}
          promotionLabel={promotionLabel}
          custom={product.badges}
          className="absolute top-3 left-3"
        />
        {countdown && promotion?.show_countdown && <Countdown endsAt={promotion.ends_at} variant="chip" prefix="" className="absolute bottom-3 left-3" />}
        <div className="absolute top-3 right-3 flex flex-col gap-2">
          <WishlistButton product={product} name={product.name} />
          {quickView && (
            <button
              type="button"
              onClick={() => quickView.open(product.slug)}
              aria-label={t('catalog.card.quickView', { name: product.name })}
              className="grid size-10 place-items-center rounded-full bg-sf-surface text-sf-heading shadow-md transition hover:bg-sf-accent hover:text-sf-accent-foreground focus-visible:bg-sf-accent focus-visible:text-sf-accent-foreground [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:focus-visible:opacity-100"
            >
              <EyeIcon aria-hidden className="size-5" />
            </button>
          )}
        </div>
      </div>

      <div className={cn('flex flex-1 flex-col gap-1.5 p-3 sm:p-4', layout === 'grid' && 'border-t')}>
        {product.brand && <p className="text-xs font-semibold tracking-wide text-sf-text uppercase">{product.brand.name}</p>}
        <h3 className="font-heading text-base leading-snug font-bold">
          <Link to={product.url} className="line-clamp-2 transition-colors hover:text-sf-accent focus-visible:text-sf-accent">
            {product.name}
          </Link>
        </h3>
        <CardRating rating={product.rating} />
        <CardSwatchRow {...swatch.row} />
        {layout === 'list' && product.short_description && <p className="line-clamp-3 text-sm">{product.short_description}</p>}
        {promoPrice ? (
          <Price price={promoPrice} compareAt={product.price} from={range} size="sm" className="mt-auto pt-1" />
        ) : (
          <Price price={product.price} priceMax={priceMax} compareAt={compareAt} size="sm" className="mt-auto pt-1" />
        )}
        <div className={cn('pt-2', layout === 'list' && 'sm:max-w-56')}>
          {actions ?? <CardCartAction product={product} />}
        </div>
      </div>
    </article>
  )
}
