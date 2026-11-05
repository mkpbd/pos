import { useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { Undo2Icon, XCircleIcon } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { isZeroDecimal } from '@/lib/money'
import { cn } from '@/lib/utils'
import { FormAlert, primaryButtonClass, secondaryButtonClass } from '../account/form-controls'
import { displayQuantity } from '../cart/quantity'
import { PlacementAttempts } from '../checkout/placement-attempt'
import { formatDateTime } from '../checkout/delivery'
import { useLocale } from '../i18n/locale'
import { rich } from '../i18n/rich'
import type { Translate } from '../i18n/translate'
import { formatPrice } from '../money'
import { useNotice } from '../notices'
import type { AccountOrderLine, AccountReturn, OrderReturnLine, OrderReturnSummary } from '../types'
import { isCancellableReturn, returnErrorMessage, returnOrderNumber, useCancelReturnMutation } from './returns-api'

const STATUS_TONE: Record<string, string> = {
  requested: 'bg-sf-primary/20 text-sf-heading',
  approved: 'bg-sf-accent/15 text-sf-heading',
  received: 'bg-sf-accent/15 text-sf-heading',
  refunded: 'bg-sf-highlight/20 text-sf-heading',
  rejected: 'bg-sf-sale/15 text-sf-sale',
  cancelled: 'bg-sf-border/60 text-sf-heading',
}

export function ReturnStatusBadge({ status, label }: { status: string; label: string }) {
  return (
    <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-bold', STATUS_TONE[status] ?? 'bg-sf-border/60 text-sf-heading')} data-testid="return-status">
      {label}
    </span>
  )
}

function lineName(line: OrderReturnLine, orderLines: AccountOrderLine[], t: Translate): string {
  if (line.product_name) return line.variant_name ? `${line.product_name} (${line.variant_name})` : line.product_name
  const source = orderLines.find((l) => l.id !== undefined && l.id === line.order_line_id)
  if (source) return source.variant_name ? `${source.product_name} (${source.variant_name})` : source.product_name
  return t('orders.returns.item')
}

/** What the refund line says for a return in its current state (null when there is nothing to say). */
function refundText(ret: OrderReturnSummary, currency: string | null, t: Translate): string | null {
  if (ret.status === 'rejected' || ret.status === 'cancelled') return null
  if (!ret.refund_amount || isZeroDecimal(ret.refund_amount)) return null
  const amount = formatPrice(ret.refund_amount, currency)
  return ret.status === 'refunded' ? t('orders.returns.refunded', { amount }) : t('orders.returns.refundDue', { amount })
}

/**
 * One return: number, status, the items, the refund and — while the store has not handled it —
 * "Cancel return". `showOrder` links the order (on the returns page).
 */
export function ReturnItem({
  ret,
  currency,
  orderLines = [],
  showOrder = false,
  onCancel,
}: {
  ret: OrderReturnSummary & Partial<Pick<AccountReturn, 'order' | 'order_number' | 'rejection_reason' | 'reason_label' | 'refunded_at'>>
  currency: string | null
  orderLines?: AccountOrderLine[]
  showOrder?: boolean
  onCancel: (ret: OrderReturnSummary) => void
}) {
  const { t, formatNumber } = useLocale()
  const orderNumber = showOrder ? returnOrderNumber(ret) : null
  const refund = refundText(ret, currency, t)

  return (
    <article className="flex flex-col gap-2 rounded-lg border border-sf-border p-4 text-sm" aria-label={t('orders.returns.aria', { number: ret.number })} data-testid="order-return">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-heading text-base font-bold text-sf-heading">{ret.number}</span>
        <ReturnStatusBadge status={ret.status} label={ret.status_label} />
        <span>{rich(t('orders.returns.requestedAt'), { date: <time dateTime={ret.created_at}>{formatDateTime(ret.created_at)}</time> })}</span>
      </div>
      {orderNumber && (
        <p>
          {rich(t('orders.returns.order'), {
            number: (
              <Link to={`/account/orders/${encodeURIComponent(orderNumber)}`} className="font-semibold text-sf-accent hover:underline">
                {orderNumber}
              </Link>
            ),
          })}
        </p>
      )}
      {ret.lines.length > 0 && (
        <ul className="flex flex-col gap-0.5" aria-label={t('orders.returns.itemsAria', { number: ret.number })}>
          {ret.lines.map((line, index) => (
            <li key={`${line.order_line_id ?? line.sku ?? 'line'}-${index}`}>
              {formatNumber(displayQuantity(line.quantity))} × {lineName(line, orderLines, t)}
            </li>
          ))}
        </ul>
      )}
      {ret.reason_label && <p>{t('orders.returns.reason', { reason: ret.reason_label })}</p>}
      {refund && (
        <p className="font-semibold text-sf-heading" data-testid="return-refund">
          {refund}
        </p>
      )}
      {ret.status === 'rejected' && ret.rejection_reason && <p className="text-sf-sale">{t('orders.returns.notAccepted', { reason: ret.rejection_reason })}</p>}
      {isCancellableReturn(ret) && (
        <button
          type="button"
          className="inline-flex items-center gap-1 self-start text-xs font-semibold text-sf-accent hover:text-sf-sale hover:underline"
          aria-label={t('orders.returns.cancelAria', { number: ret.number })}
          onClick={() => onCancel(ret)}
        >
          <XCircleIcon aria-hidden className="size-3.5" />
          {t('orders.returns.cancel')}
        </button>
      )}
    </article>
  )
}

/** The order's returns on the order detail page; nothing without returns. */
export function OrderReturnsCard({ returns, currency, orderLines, onCancel }: { returns: OrderReturnSummary[]; currency: string | null; orderLines: AccountOrderLine[]; onCancel: (ret: OrderReturnSummary) => void }) {
  const { t } = useLocale()
  if (returns.length === 0) return null
  return (
    <section aria-labelledby="order-returns" className="flex flex-col gap-3 rounded-sf-card bg-sf-surface p-5 md:p-6" data-testid="order-returns">
      <h2 id="order-returns" className="flex items-center gap-2 font-heading text-xl font-bold text-sf-heading">
        <Undo2Icon aria-hidden className="size-5" />
        {t('orders.returns.cardTitle')}
      </h2>
      <ul className="flex flex-col gap-3">
        {returns.map((ret) => (
          <li key={ret.number}>
            <ReturnItem ret={ret} currency={currency} orderLines={orderLines} onCancel={onCancel} />
          </li>
        ))}
      </ul>
      <p className="text-xs">
        <Link to="/account/returns" className="font-semibold text-sf-accent hover:underline">
          {t('orders.returns.all')}
        </Link>
      </p>
    </section>
  )
}

/**
 * "Cancel return" confirmation. Each attempt has its own Idempotency-Key; pressing the button
 * again after an open outcome (lost connection, 5xx) resends the same key.
 */
export function CancelReturnDialog({ target, onClose }: { target: OrderReturnSummary | null; onClose: () => void }) {
  const cancel = useCancelReturnMutation()
  const attempts = useRef(new PlacementAttempts())
  const [error, setError] = useState<string | null>(null)
  const notify = useNotice()
  const { t } = useLocale()

  const close = () => {
    if (cancel.isPending) return
    setError(null)
    onClose()
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!target) return
    setError(null)
    const idempotencyKey = attempts.current.keyFor({ cancel: target.number })
    cancel.mutate(
      { number: target.number, idempotencyKey },
      {
        onSuccess: () => {
          attempts.current.settle()
          notify(t('orders.returns.cancelled', { number: target.number }))
          onClose()
        },
        onError: (failure) => {
          attempts.current.settle(failure)
          setError(returnErrorMessage(failure, t))
        },
      },
    )
  }

  return (
    <Dialog open={target !== null} onOpenChange={(next) => !next && close()}>
      <DialogContent className="bg-sf-surface p-5 sm:max-w-md md:p-6">
        {target && (
          <form noValidate onSubmit={submit} className="flex flex-col gap-4" aria-label={t('orders.returns.cancel')}>
            <DialogTitle className="pr-8 font-heading text-2xl font-extrabold text-sf-heading">{t('orders.returns.cancelTitle', { number: target.number })}</DialogTitle>
            <DialogDescription>{t('orders.returns.cancelDescription')}</DialogDescription>
            <FormAlert message={error} />
            <div className="flex flex-wrap gap-3">
              <button type="submit" className={cn(primaryButtonClass, 'bg-sf-sale text-white')} disabled={cancel.isPending}>
                {cancel.isPending ? t('orders.cancelling') : t('orders.returns.cancel')}
              </button>
              <button type="button" className={secondaryButtonClass} disabled={cancel.isPending} onClick={close}>
                {t('orders.returns.keep')}
              </button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
