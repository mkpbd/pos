import { Link } from 'react-router'
import { CheckCircle2Icon, CircleAlertIcon, XCircleIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useStorefront } from '../api'
import type { ProductDetail, ProductVariant } from '../types'
import { Price } from './price'
import { VariantSelector } from './variant-selector'
import type { Selection } from './variant-selection'

function Availability({ inStock, lowStock }: { inStock: boolean; lowStock: boolean }) {
  const [Icon, text, tone] = !inStock
    ? [XCircleIcon, 'Out of stock', 'text-sf-sale']
    : lowStock
      ? [CircleAlertIcon, 'Only a few left', 'text-sf-primary-foreground']
      : [CheckCircle2Icon, 'In stock', 'text-sf-highlight']

  return (
    <p className={cn('flex items-center gap-1.5 text-sm font-semibold', tone)} data-testid="availability">
      <Icon aria-hidden className="size-4" />
      {text}
    </p>
  )
}

/**
 * Brand, price, availability, SKU and the variant selector — the product page and quick
 * view share it. Price, SKU and availability follow the selected variant (announced politely).
 */
export function ProductSummary({
  product,
  variant,
  selection,
  onChoose,
}: {
  product: ProductDetail
  variant: ProductVariant | null
  selection: Selection
  onChoose: (optionName: string, value: string) => void
}) {
  const { store } = useStorefront()
  const inStock = variant ? variant.in_stock : product.in_stock

  return (
    <div className="flex flex-col gap-5">
      {product.brand && (
        <p className="text-sm">
          Brand:{' '}
          {product.brand.slug ? (
            <Link to={`/brand/${product.brand.slug}`} className="font-semibold text-sf-accent hover:underline">
              {product.brand.name}
            </Link>
          ) : (
            <span className="font-semibold text-sf-heading">{product.brand.name}</span>
          )}
        </p>
      )}

      <div aria-live="polite" className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          {variant ? (
            <Price price={variant.price} compareAt={variant.on_sale ? variant.compare_at_price : null} size="lg" />
          ) : (
            <Price price={product.price} priceMax={product.price_max} size="lg" />
          )}
          {variant?.on_sale && variant.discount_percent ? (
            <span className="rounded-full bg-sf-sale px-2.5 py-0.5 text-sm font-bold text-white">−{variant.discount_percent} %</span>
          ) : null}
          {store.prices_include_tax === false && <span className="text-sm">Excl. VAT</span>}
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
          <Availability inStock={inStock} lowStock={variant?.low_stock ?? false} />
          {variant && (
            <p className="text-sm">
              SKU: <span className="font-medium text-sf-heading" data-testid="sku">{variant.sku}</span>
            </p>
          )}
        </div>
        {!variant && product.options.length > 0 && <p className="text-sm">Choose the options to see the price and availability.</p>}
      </div>

      <VariantSelector product={product} selection={selection} onChoose={onChoose} />

      {product.short_description && <p className="leading-relaxed whitespace-pre-line">{product.short_description}</p>}
    </div>
  )
}
