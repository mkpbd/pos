import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router'
import { useMutation } from '@tanstack/react-query'
import { PackageSearchIcon } from 'lucide-react'
import { ApiError } from '@/lib/api/client'
import { FormAlert, SubmitButton, TextField } from '../account/form-controls'
import { useCustomer } from '../account/api'
import { BD_MOBILE, bdPhoneFrom } from '../account/schemas'
import { formatDateTime } from '../checkout/delivery'
import { storeFormError } from '../form-errors'
import type { MessageKey } from '../i18n/en'
import { useLocale } from '../i18n/locale'
import { rich } from '../i18n/rich'
import { usePriceFormat } from '../money'
import { privatePage, useDocumentMeta } from '../use-document-meta'
import { OrderStatusBadge, OrderTimeline } from './order-view'
import { orderStatusLabel } from './returns-api'
import { trackOrder, type TrackedOrder } from './track-api'

const METHOD_LABELS: Record<string, MessageKey> = { cod: 'orders.trackOrder.method.cod', bank_transfer: 'orders.trackOrder.method.bankTransfer' }

const linkClass = 'font-semibold text-sf-link underline-offset-4 hover:underline'

/**
 * BD1a §6: /track-order — a guest finds an order by its number and the mobile number it was placed
 * with (`?number=` prefills the number, as the order SMS links do).
 */
export function TrackOrderPage() {
  const { t } = useLocale()
  useDocumentMeta(privatePage(t('orders.trackOrder.title')))
  const [params] = useSearchParams()
  const customer = useCustomer()
  const [number, setNumber] = useState(() => (params.get('number') ?? '').trim().slice(0, 40))
  const [phone, setPhone] = useState('')
  const [errors, setErrors] = useState<{ number?: string; phone?: string }>({})
  const track = useMutation({ mutationFn: ({ number, phone }: { number: string; phone: string }) => trackOrder(number, phone) })
  const resultRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (track.data) resultRef.current?.focus()
  }, [track.data])

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const next: typeof errors = {}
    const orderNumber = number.trim()
    const mobile = bdPhoneFrom(phone)
    if (orderNumber === '') next.number = 'orders.trackOrder.numberRequired'
    if (phone.trim() === '') next.phone = 'account.validation.mobileRequired'
    else if (!BD_MOBILE.test(mobile)) next.phone = 'account.validation.phoneInvalid'
    setErrors(next)
    if (Object.keys(next).length > 0) return
    track.mutate({ number: orderNumber, phone: mobile })
  }

  const notFound = track.error instanceof ApiError && (track.error.code === 'ORDER_NOT_FOUND' || track.error.status === 404)
  const problem = track.error ? (notFound ? t('orders.trackOrder.notFound') : storeFormError(track.error, t)) : null

  return (
    <section className="mx-auto w-full max-w-2xl px-4 py-10 sm:py-14" data-testid="track-order-page">
      <div className="rounded-sf-card bg-sf-surface p-6 shadow-sm sm:p-8">
        <h1 className="flex items-center gap-3 text-3xl font-extrabold">
          <PackageSearchIcon aria-hidden className="size-8 shrink-0 text-sf-accent" />
          {t('orders.trackOrder.title')}
        </h1>
        <p className="mt-2 text-sm">{t('orders.trackOrder.intro')}</p>
        <form noValidate onSubmit={submit} className="mt-6 grid gap-4 sm:grid-cols-2" aria-label={t('orders.trackOrder.title')}>
          <div className="sm:col-span-2">
            <FormAlert message={problem} />
          </div>
          <TextField
            label={t('orders.trackOrder.number')}
            value={number}
            onChange={(e) => setNumber(e.target.value)}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={40}
            placeholder={t('orders.trackOrder.numberPlaceholder')}
            error={errors.number}
          />
          <TextField
            label={t('orders.trackOrder.phone')}
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            maxLength={20}
            placeholder="01XXXXXXXXX"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            error={errors.phone}
          />
          <SubmitButton pending={track.isPending} pendingLabel={t('orders.trackOrder.pending')} className="sm:col-span-2">
            {t('orders.trackOrder.submit')}
          </SubmitButton>
        </form>
        {!customer && (
          <p className="mt-4 text-center text-sm">
            {rich(t('orders.trackOrder.signInHint'), {
              link: (
                <Link to="/account/login?next=%2Faccount%2Forders" className={linkClass}>
                  {t('common.account.signIn')}
                </Link>
              ),
            })}
          </p>
        )}
      </div>
      {track.data && !track.isPending && (
        <div ref={resultRef} tabIndex={-1} className="mt-6 flex flex-col gap-4 focus:outline-none" aria-live="polite">
          <TrackedOrderCard order={track.data} />
        </div>
      )}
    </section>
  )
}

function TrackedOrderCard({ order }: { order: TrackedOrder }) {
  const { t, formatNumber } = useLocale()
  const format = usePriceFormat()
  const status = orderStatusLabel(t, order.status, order.status)
  const method = METHOD_LABELS[order.payment_method] ? t(METHOD_LABELS[order.payment_method]!) : order.payment_method
  const paymentState = t(order.payment_status === 'paid' ? 'orders.paymentState.paid' : order.payment_method === 'cod' ? 'orders.paymentState.cod' : 'orders.paymentState.awaiting')
  const count = Number(order.item_count)
  const shipment = order.shipment
  const history = (Array.isArray(order.history) ? order.history : []).map((entry) => ({ ...entry, label: orderStatusLabel(t, entry.status, entry.status) }))

  return (
    <>
      <section aria-label={t('orders.trackOrder.resultLabel', { number: order.number })} className="flex flex-col gap-3 rounded-sf-card bg-sf-surface p-5 md:p-6" data-testid="tracked-order">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-heading text-xl font-bold text-sf-heading">{t('orders.trackOrder.resultLabel', { number: order.number })}</h2>
          <OrderStatusBadge label={status} />
        </div>
        <p className="text-sm">{t('orders.trackOrder.placed', { date: formatDateTime(order.placed_at) })}</p>
        <dl className="grid gap-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="font-medium text-sf-heading">{t('orders.trackOrder.total')}</dt>
            <dd data-testid="tracked-total">{format.price(order.total)}</dd>
          </div>
          <div>
            <dt className="font-medium text-sf-heading">{t('orders.trackOrder.items')}</dt>
            <dd>{Number.isFinite(count) ? formatNumber(count) : String(order.item_count)}</dd>
          </div>
          <div>
            <dt className="font-medium text-sf-heading">{t('orders.trackOrder.payment')}</dt>
            <dd data-testid="tracked-payment">
              {method} · {paymentState}
            </dd>
          </div>
        </dl>
      </section>
      <OrderTimeline
        order={{ history, courier_name: shipment?.courier_name ?? null, tracking_number: shipment?.tracking_number ?? null, tracking_url: shipment?.tracking_url ?? null }}
        withTracking
      />
    </>
  )
}
