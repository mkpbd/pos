import { Link } from 'react-router'
import { CheckCircle2Icon, CircleAlertIcon, TagIcon, XCircleIcon } from 'lucide-react'
import { compareDecimal } from '@/lib/money'
import { cn } from '@/lib/utils'
import { useStorefront } from '../api'
import { Countdown } from '../promotions/countdown-timer'
import { useLocale } from '../i18n/locale'
import { usePromotionPricing } from '../promotions/display'
import type { ProductDetail, ProductVariant } from '../types'
import { Price } from './price'
import { VariantSelector } from './variant-selector'
import type { Selection } from './variant-selection'

function Availability({ inStock, lowStock }: { inStock: boolean; lowStock: boolean }) {
  const { t } = useLocale()
  const [Icon, text, tone] = !inStock
    ? [XCircleIcon, t('catalog.stock.out'), 'text-sf-sale']
    : lowStock
      ? [CircleAlertIcon, t('catalog.stock.low'), 'text-sf-primary-foreground']
      : [CheckCircle2Icon, t('catalog.stock.in'), 'text-sf-highlight']

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
  const { t } = useLocale()
  const inStock = variant ? variant.in_stock : product.in_stock
  const promo = usePromotionPricing(product, variant)
  const range = compareDecimal(product.price, product.price_max) !== 0

  return (
    <div className="flex flex-col gap-5">
      {product.brand && (
        <p className="text-sm">
          {t('catalog.summary.brand')}{' '}
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
          {promo ? (
            <Price price={promo.price} compareAt={promo.base} from={!variant && range} size="lg" />
          ) : variant ? (
            <Price price={variant.price} compareAt={variant.on_sale ? variant.compare_at_price : null} size="lg" />
          ) : (
            <Price price={product.price} priceMax={product.price_max} size="lg" />
          )}
          {promo ? (
            promo.label && (
              <span className="rounded-full bg-sf-sale px-2.5 py-0.5 text-sm font-bold text-white" data-testid="promotion-badge">
                <span className="sr-only">{t('catalog.badges.offer')}</span>
                {promo.label}
              </span>
            )
          ) : variant?.on_sale && variant.discount_percent ? (
            <span className="rounded-full bg-sf-sale px-2.5 py-0.5 text-sm font-bold text-white">{t('catalog.badges.discount', { percent: variant.discount_percent })}</span>
          ) : null}
          {store.prices_include_tax === false && <span className="text-sm">{t('catalog.summary.exclVat')}</span>}
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
          <Availability inStock={inStock} lowStock={variant?.low_stock ?? false} />
          {variant && (
            <p className="text-sm">
              {t('catalog.summary.sku')} <span className="font-medium text-sf-heading" data-testid="sku">{variant.sku}</span>
            </p>
          )}
        </div>
        {!variant && product.options.length > 0 && <p className="text-sm">{t('catalog.summary.chooseOptions')}</p>}
      </div>

      {promo && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-sf-card bg-sf-sale/10 px-4 py-3" data-testid="product-promotion">
          <p className="inline-flex items-center gap-2 text-sm font-bold text-sf-sale">
            <TagIcon aria-hidden className="size-4 shrink-0" />
            {promo.promotion.name}
          </p>
          {promo.promotion.show_countdown && <Countdown endsAt={promo.promotion.ends_at} />}
        </div>
      )}

      <VariantSelector product={product} selection={selection} onChoose={onChoose} />

      {product.short_description && <p className="leading-relaxed whitespace-pre-line">{product.short_description}</p>}
    </div>
  )
}
