import { useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { Undo2Icon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { AccountShell } from '../account/account-pages'
import { Spinner, primaryButtonClass } from '../account/form-controls'
import { Pagination } from '../catalog/listing-toolbar'
import { storeFormError } from '../form-errors'
import { useStorefront } from '../api'
import { useLocale } from '../i18n/locale'
import type { OrderReturnSummary } from '../types'
import { privatePage, useDocumentMeta } from '../use-document-meta'
import { useAccountReturnsQuery } from './returns-api'
import { CancelReturnDialog, ReturnItem } from './returns-view'

const hrefFor = (page: number) => (page > 1 ? `/account/returns?page=${page}` : '/account/returns')

/** /account/returns — the customer's own returns, newest first, with status and refund (?page=). */
export function AccountReturnsPage() {
  const { t } = useLocale()
  useDocumentMeta(privatePage(t('orders.returns.title')))
  const [params] = useSearchParams()
  const page = Math.max(1, Number.parseInt(params.get('page') ?? '1', 10) || 1)
  const returns = useAccountReturnsQuery(page)
  const storeCurrency = useStorefront().store.currency
  const [cancelling, setCancelling] = useState<OrderReturnSummary | null>(null)
  const data = returns.data

  return (
    <AccountShell title={t('orders.returns.title')}>
      <p className="text-sm">{t('orders.returns.intro')}</p>
      {returns.error && !data ? (
        <div className="mt-6 rounded-sf-card bg-sf-surface p-6">
          <p role="alert">{storeFormError(returns.error, t)}</p>
          <button type="button" className={`${primaryButtonClass} mt-3`} disabled={returns.isFetching} onClick={() => void returns.refetch()}>
            {t('common.tryAgain')}
          </button>
        </div>
      ) : !data ? (
        <Spinner label={t('orders.returns.loading')} />
      ) : data.items.length === 0 ? (
        <div className="mt-6 flex flex-col items-center gap-4 rounded-sf-card bg-sf-surface p-10 text-center" data-testid="returns-empty">
          <Undo2Icon aria-hidden className="size-12 text-sf-border" />
          <p className="font-semibold text-sf-heading">{t('orders.returns.empty')}</p>
          <Link to="/account/orders?status=delivered" className={primaryButtonClass}>
            {t('orders.returns.viewDelivered')}
          </Link>
        </div>
      ) : (
        <>
          <ul className={cn('mt-6 flex flex-col gap-3 transition-opacity', returns.isPlaceholderData && 'opacity-60')} aria-label={t('orders.returns.listLabel')} aria-busy={returns.isPlaceholderData}>
            {data.items.map((ret) => (
              <li key={ret.number} className="rounded-sf-card bg-sf-surface">
                <ReturnItem ret={ret} currency={ret.currency ?? storeCurrency ?? null} showOrder onCancel={setCancelling} />
              </li>
            ))}
          </ul>
          <Pagination pagination={data.pagination} hrefFor={hrefFor} />
        </>
      )}
      <CancelReturnDialog target={cancelling} onClose={() => setCancelling(null)} />
    </AccountShell>
  )
}
