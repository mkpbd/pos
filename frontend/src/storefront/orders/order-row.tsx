import { Link } from 'react-router'
import { ChevronRightIcon } from 'lucide-react'
import { displayQuantity } from '../cart/quantity'
import { ProductImage } from '../catalog/product-image'
import { formatDateTime } from '../checkout/delivery'
import { useLocale } from '../i18n/locale'
import { orderStatusLabel } from './returns-api'
import { formatPrice } from '../money'
import type { AccountOrderRow } from '../types'
import { OrderStatusBadge } from './order-view'

/** An order in the customer's order history (and the overview's recent orders). */
export function OrderRow({ row }: { row: AccountOrderRow }) {
  const { t } = useLocale()
  const itemCount = t('common.items', { count: Number(displayQuantity(String(row.item_count))) })
  return (
    <Link
      to={`/account/orders/${encodeURIComponent(row.number)}`}
      className="flex items-center gap-4 rounded-sf-card bg-sf-surface p-4 transition hover:shadow-md focus-visible:shadow-md"
      data-testid="order-row"
    >
      <ProductImage image={row.first_item?.image_url ? { url: row.first_item.image_url, alt: null } : null} alt={row.first_item?.name ?? ''} className="w-14 shrink-0 rounded-lg border" />
      <div className="min-w-0 flex-1 text-sm">
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="font-heading text-base font-bold text-sf-heading">{row.number}</span>
          <OrderStatusBadge label={orderStatusLabel(t, row.status, row.status_label)} />
        </p>
        <p className="mt-1 truncate">
          {row.first_item?.name}
          {row.first_item ? ' · ' : ''}
          {itemCount}
        </p>
        <p className="text-xs">
          <time dateTime={row.placed_at}>{formatDateTime(row.placed_at)}</time> · {row.payment_method_label}
        </p>
      </div>
      <span className="shrink-0 font-semibold text-sf-heading">{formatPrice(row.total, row.currency)}</span>
      <ChevronRightIcon aria-hidden className="size-5 shrink-0 text-sf-border" />
    </Link>
  )
}
