import { useId, useRef, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router'
import { ArrowLeftIcon, PackageOpenIcon, PencilIcon, RotateCcwIcon, StarIcon, XCircleIcon } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { ApiError } from '@/lib/api/client'
import { cn } from '@/lib/utils'
import { AccountShell } from '../account/account-pages'
import { FormAlert, Spinner, inputClass, primaryButtonClass, secondaryButtonClass } from '../account/form-controls'
import { useCartDrawer } from '../cart/cart-drawer-context'
import { PlacementAttempts } from '../checkout/placement-attempt'
import { formatDateTime } from '../checkout/delivery'
import { storeFormError } from '../form-errors'
import { useLocale } from '../i18n/locale'
import { rich } from '../i18n/rich'
import { useNotice } from '../notices'
import { reviewStatusLabel, useMyReviewsQuery } from '../reviews/api'
import { ReviewDialog, type ReviewTarget } from '../reviews/review-dialog'
import { Stars } from '../reviews/stars'
import type { AccountOrder, AccountOrderLine, OrderReturnSummary } from '../types'
import { privatePage, useDocumentMeta } from '../use-document-meta'
import { reorderNotice, useAccountOrderQuery, useCancelOrderMutation, useReorderMutation } from './account-api'
import { ReturnRequestDialog } from './return-request-dialog'
import { canRequestReturn } from './returns-api'
import { CancelReturnDialog, OrderReturnsCard } from './returns-view'
import { OrderAddressCard, OrderDeliveryCard, OrderItemsCard, OrderStatusBadge, OrderTimeline, OrderTotalsCard, PaymentInstructionsCard } from './order-view'

const REASON_MAX = 200

/** /account/orders/:number — the customer's own order with tracking, cancel, buy again and reviews. */
export function AccountOrderPage() {
  const { number = '' } = useParams()
  const order = useAccountOrderQuery(number)
  const { t } = useLocale()
  const notFound = order.error instanceof ApiError && order.error.status === 404
  useDocumentMeta(privatePage(order.data ? t('orders.title', { number: order.data.number }) : notFound ? t('orders.notFoundTitle') : null))

  const back = (
    <Link to="/account/orders" className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-sf-accent hover:underline">
      <ArrowLeftIcon aria-hidden className="size-4" />
      {t('orders.detail.allOrders')}
    </Link>
  )

  if (order.data) {
    return (
      <AccountShell title={t('orders.title', { number: order.data.number })}>
        {back}
        <AccountOrderDetails order={order.data} />
      </AccountShell>
    )
  }

  return (
    <AccountShell title={notFound ? t('orders.notFoundTitle') : t('orders.titleShort')}>
      {back}
      {notFound ? (
        <div className="rounded-sf-card bg-sf-surface p-8 text-center">
          <p className="font-semibold text-sf-heading">{t('orders.detail.notFound')}</p>
          <p className="mt-1 text-sm">{t('orders.detail.guestNote')}</p>
        </div>
      ) : order.error ? (
        <div className="rounded-sf-card bg-sf-surface p-6">
          <p role="alert">{storeFormError(order.error, t)}</p>
          <button type="button" className={`${primaryButtonClass} mt-3`} disabled={order.isFetching} onClick={() => void order.refetch()}>
            {t('common.tryAgain')}
          </button>
        </div>
      ) : (
        <Spinner label={t('orders.loading')} />
      )}
    </AccountShell>
  )
}

function AccountOrderDetails({ order }: { order: AccountOrder }) {
  const [cancelling, setCancelling] = useState(false)
  const [reviewing, setReviewing] = useState<ReviewTarget | null>(null)
  const [returning, setReturning] = useState(false)
  const [cancellingReturn, setCancellingReturn] = useState<OrderReturnSummary | null>(null)
  const returnable = canRequestReturn(order)
  const reorder = useReorderMutation()
  const drawer = useCartDrawer()
  const notify = useNotice()
  const { t } = useLocale()
  const hasReviews = order.lines.some((line) => line.review)
  const myReviews = useMyReviewsQuery(hasReviews)
  const buyAgainRef = useRef<HTMLButtonElement>(null)

  const buyAgain = () =>
    reorder.mutate(order.number, {
      onSuccess: (result) => {
        notify(reorderNotice(result, t))
        if (result.added.length > 0) drawer?.open(buyAgainRef.current)
      },
      onError: (error) => notify(error instanceof ApiError && error.status === 429 ? t('common.form.tooManyAttempts') : t('orders.detail.buyAgainFailed', { error: storeFormError(error, t) })),
    })

  const editReview = (line: AccountOrderLine) => {
    const review = myReviews.data?.find((r) => r.id === line.review?.id)
    if (review) setReviewing({ mode: 'edit', review, productName: line.product_name })
  }

  const lineActions = (line: AccountOrderLine) => {
    if (line.review) {
      const full = myReviews.data?.find((r) => r.id === line.review?.id)
      return (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1" data-testid="line-review">
          <span className="inline-flex items-center gap-1.5 text-xs">
            {t('orders.detail.yourReview')} <Stars rating={line.review.rating} size="size-3.5" />
            <span className="font-semibold text-sf-heading">{reviewStatusLabel(line.review.status, t)}</span>
          </span>
          {line.review.status === 'rejected' && full?.rejection_reason && <span className="text-xs text-sf-sale">{t('orders.detail.reviewReason', { reason: full.rejection_reason })}</span>}
          <button
            type="button"
            className="inline-flex items-center gap-1 text-xs font-semibold text-sf-accent hover:underline disabled:opacity-60"
            disabled={!full}
            onClick={() => editReview(line)}
            aria-label={t('orders.detail.editReviewAria', { product: line.product_name })}
          >
            <PencilIcon aria-hidden className="size-3.5" />
            {t('orders.detail.editReview')}
          </button>
        </div>
      )
    }
    if (line.reviewable && line.product_id) {
      const productId = line.product_id
      return (
        <button
          type="button"
          className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-sf-accent hover:underline"
          onClick={() => setReviewing({ mode: 'create', productId, productName: line.product_name })}
          aria-label={t('orders.detail.writeReviewAria', { product: line.product_name })}
        >
          <StarIcon aria-hidden className="size-3.5" />
          {t('orders.detail.writeReview')}
        </button>
      )
    }
    return null
  }

  return (
    <>
      <header className="flex flex-col gap-3">
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <OrderStatusBadge label={order.status_label} />
          <span>{rich(t('orders.placedAt'), { date: <time dateTime={order.placed_at}>{formatDateTime(order.placed_at)}</time> })}</span>
        </p>
        <div className="flex flex-wrap gap-3">
          <button ref={buyAgainRef} type="button" className={primaryButtonClass} disabled={reorder.isPending} onClick={buyAgain}>
            <RotateCcwIcon aria-hidden className="size-4" />
            {reorder.isPending ? t('orders.detail.addingToCart') : t('orders.detail.buyAgain')}
          </button>
          {returnable && (
            <button type="button" className={secondaryButtonClass} onClick={() => setReturning(true)}>
              <PackageOpenIcon aria-hidden className="size-4" />
              {t('orders.detail.returnItems')}
            </button>
          )}
          {order.can_cancel && (
            <button type="button" className={cn(secondaryButtonClass, 'hover:border-sf-sale hover:text-sf-sale')} onClick={() => setCancelling(true)}>
              <XCircleIcon aria-hidden className="size-4" />
              {t('orders.detail.cancelOrder')}
            </button>
          )}
        </div>
        {returnable && order.return_deadline && (
          <p className="text-sm" data-testid="return-deadline">
            {rich(t('orders.detail.returnsUntil'), {
              date: (
                <time dateTime={order.return_deadline} className="font-semibold text-sf-heading">
                  {formatDateTime(order.return_deadline)}
                </time>
              ),
            })}
          </p>
        )}
      </header>

      <PaymentInstructionsCard order={order} />

      <div className="mt-6 grid items-start gap-6 xl:grid-cols-[1fr_20rem]">
        <div className="flex min-w-0 flex-col gap-6">
          <OrderItemsCard lines={order.lines} currency={order.currency} lineActions={lineActions} />
          <OrderReturnsCard returns={order.returns ?? []} currency={order.currency} orderLines={order.lines} onCancel={setCancellingReturn} />
          <div className="grid gap-6 md:grid-cols-2">
            <OrderAddressCard address={order.shipping_address} />
            <OrderDeliveryCard order={order} showCourier={false} />
          </div>
        </div>
        <div className="flex flex-col gap-6">
          <OrderTimeline order={order} withTracking />
          <OrderTotalsCard order={order} />
        </div>
      </div>

      <CancelOrderDialog order={order} open={cancelling} onClose={() => setCancelling(false)} />
      <ReviewDialog target={reviewing} onClose={() => setReviewing(null)} />
      <ReturnRequestDialog order={order} open={returning} onClose={() => setReturning(false)} />
      <CancelReturnDialog target={cancellingReturn} onClose={() => setCancellingReturn(null)} />
    </>
  )
}

/**
 * "Cancel order" with an optional reason. Each attempt has its own Idempotency-Key; pressing
 * the button again after an open outcome (lost connection, 5xx) resends the same key.
 */
function CancelOrderDialog({ order, open, onClose }: { order: AccountOrder; open: boolean; onClose: () => void }) {
  const cancel = useCancelOrderMutation(order.number)
  const attempts = useRef(new PlacementAttempts())
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const notify = useNotice()
  const { t } = useLocale()
  const reasonId = useId()

  const close = () => {
    if (cancel.isPending) return
    setError(null)
    onClose()
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    const trimmed = reason.trim() || null
    const idempotencyKey = attempts.current.keyFor({ number: order.number, reason: trimmed })
    cancel.mutate(
      { reason: trimmed, idempotencyKey },
      {
        onSuccess: () => {
          attempts.current.settle()
          setReason('')
          notify(t('orders.cancel.done', { number: order.number }))
          onClose()
        },
        onError: (failure) => {
          attempts.current.settle(failure)
          if (failure instanceof ApiError && failure.code === 'ORDER_NOT_CANCELLABLE') setError(t('orders.cancel.notCancellable'))
          else setError(storeFormError(failure, t))
        },
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent className="bg-sf-surface p-5 sm:max-w-md md:p-6">
        <form noValidate onSubmit={submit} className="flex flex-col gap-4" aria-label={t('orders.detail.cancelOrder')}>
          <DialogTitle className="pr-8 font-heading text-2xl font-extrabold text-sf-heading">{t('orders.cancel.title', { number: order.number })}</DialogTitle>
          <DialogDescription>{t('orders.cancel.description')}</DialogDescription>
          <FormAlert message={error} />
          <div className="flex flex-col gap-1.5">
            <label htmlFor={reasonId} className="text-sm font-medium text-sf-heading">
              {t('orders.cancel.reason')}
            </label>
            <textarea id={reasonId} rows={3} maxLength={REASON_MAX} value={reason} onChange={(e) => setReason(e.target.value)} className={cn(inputClass, 'resize-y')} disabled={cancel.isPending} />
          </div>
          <div className="flex flex-wrap gap-3">
            <button type="submit" className={cn(primaryButtonClass, 'bg-sf-sale text-white')} disabled={cancel.isPending}>
              {cancel.isPending ? t('orders.cancelling') : t('orders.detail.cancelOrder')}
            </button>
            <button type="button" className={secondaryButtonClass} disabled={cancel.isPending} onClick={close}>
              {t('orders.cancel.keep')}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
