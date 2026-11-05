import { Link, useSearchParams } from 'react-router'
import { PackageIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { AccountShell } from '../account/account-pages'
import { Spinner, primaryButtonClass } from '../account/form-controls'
import { Pagination } from '../catalog/listing-toolbar'
import { storeFormError } from '../form-errors'
import type { MessageKey } from '../i18n/en'
import { useLocale } from '../i18n/locale'
import type { AccountOrderFilter } from '../types'
import { privatePage, useDocumentMeta } from '../use-document-meta'
import { parseOrderFilter, useAccountOrdersQuery } from './account-api'
import { OrderRow } from './order-row'

const TABS: { status: AccountOrderFilter | null; label: MessageKey }[] = [
  { status: null, label: 'orders.list.tab.all' },
  { status: 'open', label: 'orders.list.tab.open' },
  { status: 'delivered', label: 'orders.list.tab.delivered' },
  { status: 'cancelled', label: 'orders.list.tab.cancelled' },
]

const EMPTY: Record<AccountOrderFilter | 'all', MessageKey> = {
  all: 'orders.list.empty.all',
  open: 'orders.list.empty.open',
  delivered: 'orders.list.empty.delivered',
  cancelled: 'orders.list.empty.cancelled',
}

function hrefFor(status: AccountOrderFilter | null, page = 1): string {
  const params = new URLSearchParams()
  if (status) params.set('status', status)
  if (page > 1) params.set('page', String(page))
  const query = params.toString()
  return query ? `/account/orders?${query}` : '/account/orders'
}

/** /account/orders — the customer's own orders, newest first, filtered by status (?status=&page=). */
export function AccountOrdersPage() {
  const { t } = useLocale()
  useDocumentMeta(privatePage(t('orders.list.title')))
  const [params] = useSearchParams()
  const status = parseOrderFilter(params.get('status'))
  const page = Math.max(1, Number.parseInt(params.get('page') ?? '1', 10) || 1)
  const orders = useAccountOrdersQuery(status, page)
  const data = orders.data

  return (
    <AccountShell title={t('orders.list.title')}>
      <nav aria-label={t('orders.list.statusNav')}>
        <ul className="flex flex-wrap gap-2">
          {TABS.map((tab) => {
            const active = tab.status === status
            return (
              <li key={tab.label}>
                <Link
                  to={hrefFor(tab.status)}
                  aria-current={active ? 'page' : undefined}
                  className={cn('block rounded-sf-button px-4 py-1.5 text-sm font-bold transition', active ? 'bg-sf-heading text-white' : 'bg-sf-surface text-sf-heading hover:text-sf-accent')}
                >
                  {t(tab.label)}
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>

      {orders.error && !data ? (
        <div className="mt-6 rounded-sf-card bg-sf-surface p-6">
          <p role="alert">{storeFormError(orders.error, t)}</p>
          <button type="button" className={`${primaryButtonClass} mt-3`} disabled={orders.isFetching} onClick={() => void orders.refetch()}>
            {t('common.tryAgain')}
          </button>
        </div>
      ) : !data ? (
        <Spinner label={t('orders.loadingList')} />
      ) : data.items.length === 0 ? (
        <div className="mt-6 flex flex-col items-center gap-4 rounded-sf-card bg-sf-surface p-10 text-center" data-testid="orders-empty">
          <PackageIcon aria-hidden className="size-12 text-sf-border" />
          <p className="font-semibold text-sf-heading">{t(EMPTY[status ?? 'all'])}</p>
          <Link to="/shop" className={primaryButtonClass}>
            {t('orders.startShopping')}
          </Link>
        </div>
      ) : (
        <>
          <ul className={cn('mt-6 flex flex-col gap-3 transition-opacity', orders.isPlaceholderData && 'opacity-60')} aria-label={t('orders.list.listLabel')} aria-busy={orders.isPlaceholderData}>
            {data.items.map((row) => (
              <li key={row.number}>
                <OrderRow row={row} />
              </li>
            ))}
          </ul>
          <Pagination pagination={data.pagination} hrefFor={(p) => hrefFor(status, p)} />
        </>
      )}
    </AccountShell>
  )
}
