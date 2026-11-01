import { Link, useSearchParams } from 'react-router'
import { PackageIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { AccountShell } from '../account/account-pages'
import { Spinner, primaryButtonClass } from '../account/form-controls'
import { Pagination } from '../catalog/listing-toolbar'
import { storeFormError } from '../form-errors'
import type { AccountOrderFilter } from '../types'
import { privatePage, useDocumentMeta } from '../use-document-meta'
import { parseOrderFilter, useAccountOrdersQuery } from './account-api'
import { OrderRow } from './order-row'

const TABS: { status: AccountOrderFilter | null; label: string }[] = [
  { status: null, label: 'All' },
  { status: 'open', label: 'Open' },
  { status: 'delivered', label: 'Delivered' },
  { status: 'cancelled', label: 'Cancelled' },
]

const EMPTY: Record<string, string> = {
  all: 'You have not placed an order yet.',
  open: 'You have no open orders.',
  delivered: 'None of your orders has been delivered yet.',
  cancelled: 'You have no cancelled orders.',
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
  useDocumentMeta(privatePage('My orders'))
  const [params] = useSearchParams()
  const status = parseOrderFilter(params.get('status'))
  const page = Math.max(1, Number.parseInt(params.get('page') ?? '1', 10) || 1)
  const orders = useAccountOrdersQuery(status, page)
  const data = orders.data

  return (
    <AccountShell title="My orders">
      <nav aria-label="Order status">
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
                  {tab.label}
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>

      {orders.error && !data ? (
        <div className="mt-6 rounded-sf-card bg-sf-surface p-6">
          <p role="alert">{storeFormError(orders.error)}</p>
          <button type="button" className={`${primaryButtonClass} mt-3`} disabled={orders.isFetching} onClick={() => void orders.refetch()}>
            Try again
          </button>
        </div>
      ) : !data ? (
        <Spinner label="Loading your orders" />
      ) : data.items.length === 0 ? (
        <div className="mt-6 flex flex-col items-center gap-4 rounded-sf-card bg-sf-surface p-10 text-center" data-testid="orders-empty">
          <PackageIcon aria-hidden className="size-12 text-sf-border" />
          <p className="font-semibold text-sf-heading">{EMPTY[status ?? 'all']}</p>
          <Link to="/shop" className={primaryButtonClass}>
            Start shopping
          </Link>
        </div>
      ) : (
        <>
          <ul className={cn('mt-6 flex flex-col gap-3 transition-opacity', orders.isPlaceholderData && 'opacity-60')} aria-label="Orders" aria-busy={orders.isPlaceholderData}>
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
