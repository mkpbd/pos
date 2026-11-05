import { cn } from '@/lib/utils'
import { useLocale } from '../i18n/locale'
import { usePriceFormat } from '../money'

/**
 * A price (or price range when variants differ) with the compare-at price struck through
 * when on sale. Amounts are the server's decimal strings.
 */
export function Price({
  price,
  priceMax,
  compareAt,
  from = false,
  size = 'md',
  className,
}: {
  price: string
  priceMax?: string
  compareAt?: string | null
  /** "From …": the lowest of prices that differ (a promotion on a product whose variants differ). */
  from?: boolean
  size?: 'sm' | 'md' | 'lg'
  className?: string
}) {
  const format = usePriceFormat()
  const { t } = useLocale()
  const current = priceMax ? format.range(price, priceMax) : format.price(price)

  return (
    <p className={cn('flex flex-wrap items-baseline gap-x-2 gap-y-0.5', className)}>
      <span className={cn('font-bold text-sf-heading', size === 'lg' ? 'text-3xl' : size === 'md' ? 'text-lg' : 'text-base')} data-testid="price">
        {compareAt && <span className="sr-only">{t('catalog.price.salePrice')}</span>}
        {from && <span className="text-[0.8em] font-semibold">{t('catalog.price.from')}</span>}
        {current}
      </span>
      {compareAt && (
        <s className={cn('text-sf-text', size === 'lg' ? 'text-lg' : 'text-sm')} data-testid="compare-price">
          <span className="sr-only">{t('catalog.price.originalPrice')}</span>
          {format.price(compareAt)}
        </s>
      )}
    </p>
  )
}
