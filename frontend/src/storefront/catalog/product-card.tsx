import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { EyeIcon } from 'lucide-react'
import { compareDecimal } from '@/lib/money'
import { cn } from '@/lib/utils'
import { CardCartAction } from '../cart/add-to-cart'
import type { ProductCard as Card } from '../types'
import { WishlistButton } from '../wishlist/wishlist-button'
import { Price } from './price'
import { ProductImage } from './product-image'
import { useQuickView } from './quick-view-context'

/** Sale / New / Out of stock badges over a product image. */
export function ProductBadges({ onSale, discountPercent, isNew, inStock, className }: { onSale: boolean; discountPercent: number | null; isNew: boolean; inStock: boolean; className?: string }) {
  if (!onSale && !isNew && inStock) return null

  return (
    <ul className={cn('pointer-events-none flex flex-col items-start gap-1.5', className)} aria-label="Product labels">
      {onSale && (
        <li className="rounded-full bg-sf-sale px-2.5 py-0.5 text-xs font-bold text-white">
          {discountPercent ? `Sale −${discountPercent} %` : 'Sale'}
        </li>
      )}
      {isNew && <li className="rounded-full bg-sf-highlight px-2.5 py-0.5 text-xs font-bold text-white">New</li>}
      {!inStock && <li className="rounded-full bg-sf-heading px-2.5 py-0.5 text-xs font-bold text-white">Out of stock</li>}
    </ul>
  )
}

/**
 * A product in a grid, carousel or list: image (second image on hover), badges, brand,
 * name, price (range when the variants differ), wishlist heart, quick view button and the
 * buy action (add to cart for single-variant products, else a link to choose options). Hover-only parts
 * also show on keyboard focus, and the quick view button is always visible on touch screens.
 */
export function ProductCard({ product, layout = 'grid', eager = false, actions }: { product: Card; layout?: 'grid' | 'list'; eager?: boolean; actions?: ReactNode }) {
  const quickView = useQuickView()
  const priceMax = compareDecimal(product.price, product.price_max) !== 0 ? product.price_max : undefined
  const compareAt = product.on_sale && !priceMax ? product.compare_at_price : null

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
          <ProductImage image={product.image} alt={product.name} eager={eager} imgClassName="transition-transform duration-500 group-hover:scale-105 motion-reduce:transition-none" />
          {product.hover_image && (
            <ProductImage
              image={product.hover_image}
              alt={product.name}
              className="absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
            />
          )}
        </Link>
        <ProductBadges onSale={product.on_sale} discountPercent={product.discount_percent} isNew={product.is_new} inStock={product.in_stock} className="absolute top-3 left-3" />
        <div className="absolute top-3 right-3 flex flex-col gap-2">
          <WishlistButton product={product} name={product.name} />
          {quickView && (
            <button
              type="button"
              onClick={() => quickView.open(product.slug)}
              aria-label={`Quick view: ${product.name}`}
              className="grid size-10 place-items-center rounded-full bg-sf-surface text-sf-heading shadow-md transition hover:bg-sf-accent hover:text-sf-accent-foreground focus-visible:bg-sf-accent focus-visible:text-sf-accent-foreground [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:focus-visible:opacity-100"
            >
              <EyeIcon aria-hidden className="size-5" />
            </button>
          )}
        </div>
      </div>

      <div className={cn('flex flex-1 flex-col gap-1.5 p-4', layout === 'grid' && 'border-t')}>
        {product.brand && <p className="text-xs font-semibold tracking-wide text-sf-text uppercase">{product.brand.name}</p>}
        <h3 className="font-heading text-base leading-snug font-bold">
          <Link to={product.url} className="line-clamp-2 transition-colors hover:text-sf-accent focus-visible:text-sf-accent">
            {product.name}
          </Link>
        </h3>
        {layout === 'list' && product.short_description && <p className="line-clamp-3 text-sm">{product.short_description}</p>}
        <Price price={product.price} priceMax={priceMax} compareAt={compareAt} size="sm" className="mt-auto pt-1" />
        <div className={cn('pt-2', layout === 'list' && 'sm:max-w-56')}>
          {actions ?? <CardCartAction product={product} />}
        </div>
      </div>
    </article>
  )
}
