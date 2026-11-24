import { useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { AlertTriangleIcon, ArrowLeftIcon, Loader2Icon, Trash2Icon, UserIcon, XIcon } from 'lucide-react'
import { toast } from 'sonner'
import { FormField } from '@/components/common/form-field'
import { VariantPicker } from '@/components/common/variant-picker'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useCan } from '@/features/auth/use-auth'
import { isRetryable, useIdempotencyKey } from '@/features/returns/api'
import { useDistrictsQuery, useDivisionsQuery } from '@/features/shipping/api'
import type { WebOrder, WebPaymentMethod } from '@/features/web-orders/api'
import { isSendMoneyCode } from '@/features/online-payments/gateway-form'
import { CustomerSearch } from '@/features/web-orders/components/customer-search'
import { PhoneHistoryStrip } from '@/features/web-orders/components/phone-history-strip'
import {
  changedPreview,
  CHANNEL_LABELS,
  createBodyFrom,
  editBodyFrom,
  effectivePaymentMethod,
  effectiveShippingMethod,
  lineIssue,
  NOTES_MAX,
  normalizedPhone,
  notEditableMessage,
  quoteInputFrom,
  REASON_MAX,
  submitErrorMessage,
  validateDraft,
  withContact,
  withCustomer,
  withLineAdded,
  type DraftErrors,
  type OrderDraft,
} from '@/features/web-orders/order-entry'
import {
  ORDER_CHANNELS,
  orderEntryKeys,
  useCreateStaffOrderMutation,
  useEditOrderMutation,
  useStaffQuoteQuery,
  type OrderChannel,
  type StaffQuote,
  type StaffQuoteInput,
} from '@/features/web-orders/order-entry-api'
import { etaLabel, paymentMethodLabel, promotionKindLabel } from '@/features/web-orders/orders'
import { ApiError } from '@/lib/api/client'
import { fieldErrorMap } from '@/lib/forms'
import { formatMoney, isZeroDecimal, trimDecimal } from '@/lib/money'
import { useDebouncedValue } from '@/lib/use-debounced-value'

/** Error keys shown next to a field; any other server error is listed above the submit button. */
const FIELD_KEYS = new Set([
  'customer_id', 'contact.name', 'contact.phone', 'contact.email', 'lines',
  'address.recipient_name', 'address.phone', 'address.division_id', 'address.district_id', 'address.area', 'address.address_line', 'address.postcode',
  'shipping_method_id', 'payment_method', 'channel', 'coupon_code', 'notes', 'reason',
])
const LINE_KEY = /^lines\.(\d+)\.(variant_id|quantity)$/

type Props = {
  mode: 'create' | 'edit'
  initial: OrderDraft
  /** The order being changed (edit only). */
  order?: WebOrder
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader><CardTitle>{title}</CardTitle></CardHeader>
      <CardContent className="flex flex-col gap-4">{children}</CardContent>
    </Card>
  )
}

function ErrorText({ id, children }: { id?: string; children: ReactNode }) {
  return <p id={id} className="text-sm text-destructive">{children}</p>
}

/** One form for a new staff-entered order and for changing an unpaid order before it ships (BD1b). */
export function OrderEntryForm({ mode, initial, order }: Props) {
  const can = useCan()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const create = useCreateStaffOrderMutation()
  const edit = useEditOrderMutation()
  const idempotency = useIdempotencyKey()
  const divisions = useDivisionsQuery()
  const districts = useDistrictsQuery()

  const [draft, setDraft] = useState<OrderDraft>(initial)
  const [tried, setTried] = useState(false)
  const [serverErrors, setServerErrors] = useState<DraftErrors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [totalChanged, setTotalChanged] = useState<{ from: string; to: string } | null>(null)

  const isEdit = mode === 'edit'
  const saving = create.isPending || edit.isPending

  // Live totals: the quote follows the draft after a short pause in typing.
  const [lastPayment, setLastPayment] = useState<WebPaymentMethod | ''>('')
  const quotePayment = isEdit ? (order?.payment_method ?? '') : draft.payment_method || lastPayment
  const quoteInput = quoteInputFrom(draft, { orderId: order?.id, paymentMethod: quotePayment })
  const inputKey = JSON.stringify(quoteInput)
  const debouncedKey = useDebouncedValue(inputKey, 400)
  const debouncedInput = useMemo(() => JSON.parse(debouncedKey) as StaffQuoteInput | null, [debouncedKey])
  const quoteQuery = useStaffQuoteQuery(debouncedInput)
  const quote = quoteInput ? quoteQuery.data : undefined
  const settled = quoteInput !== null && debouncedKey === inputKey && !!quoteQuery.data && !quoteQuery.isFetching && !quoteQuery.isPlaceholderData

  const shippingMethodId = effectiveShippingMethod(draft, quote)
  const paymentMethod: WebPaymentMethod | '' = isEdit ? (order?.payment_method ?? '') : effectivePaymentMethod(draft, quote)
  // A payment method the quote settled on by itself (the only one offered) is priced on the next quote.
  if (!isEdit && !draft.payment_method && paymentMethod !== lastPayment) setLastPayment(paymentMethod)

  const update = (next: OrderDraft) => {
    setDraft(next)
    setServerErrors({})
    setTotalChanged(null)
  }
  const set = (patch: Partial<OrderDraft>) => update({ ...draft, ...patch })
  const setAddress = (patch: Partial<OrderDraft['address']>) => update({ ...draft, address: { ...draft.address, ...patch } })

  const codRefused = paymentMethod === 'cod' && !!quote && !!shippingMethodId && settled && quote.payment_method === null
  const clientErrors = tried ? validateDraft(draft, mode, { shippingMethodId, paymentMethod }) : {}
  if (tried && codRefused && !clientErrors.payment_method) clientErrors.payment_method = 'Cash on delivery is not available with this delivery method.'
  const errors: DraftErrors = { ...clientErrors, ...serverErrors }
  const otherErrors = Object.entries(serverErrors).filter(([k]) => !FIELD_KEYS.has(k) && !LINE_KEY.test(k))

  const contactPhone = normalizedPhone(draft.contact.phone)
  const divisionList = divisions.data ?? []
  const districtList = (districts.data ?? []).filter((d) => d.division_id === draft.address.division_id).sort((a, b) => a.name.localeCompare(b.name))
  const quoteLine = (variantId: string) => quote?.lines.find((l) => l.variant_id === variantId)

  const showTotalChange = (error: unknown) => {
    const preview = changedPreview(error)
    if (!preview || !debouncedInput) return false
    const previous = quoteQuery.data
    queryClient.setQueryData<StaffQuote>(orderEntryKeys.quote(debouncedInput), { ...(previous ?? {}), ...preview } as StaffQuote)
    setTotalChanged({ from: previous?.total ?? preview.total, to: preview.total })
    return true
  }

  const onError = (error: unknown) => {
    idempotency.settle(error)
    if (error instanceof ApiError && error.code === 'TOTAL_CHANGED') {
      if (!showTotalChange(error)) {
        setFormError('Prices or offers changed while you were entering the order. Check the new total and submit again.')
        void quoteQuery.refetch()
      }
      return
    }
    const notEditable = notEditableMessage(error)
    if (notEditable) {
      setFormError(notEditable)
      return
    }
    if (error instanceof ApiError && error.code === 'VALIDATION_FAILED') {
      setServerErrors(fieldErrorMap(error))
      setFormError('Please correct the highlighted fields.')
      return
    }
    if (error instanceof ApiError && ['ITEMS_UNAVAILABLE', 'SHIPPING_UNAVAILABLE', 'PAYMENT_METHOD_UNAVAILABLE'].includes(error.code)) {
      setFormError(submitErrorMessage(error))
      void quoteQuery.refetch()
      return
    }
    setFormError(submitErrorMessage(error))
    if (isRetryable(error)) toast.message('You can press the button again to retry safely.')
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (saving) return
    setTried(true)
    setFormError(null)
    setServerErrors({})
    const problems = validateDraft(draft, mode, { shippingMethodId, paymentMethod })
    if (Object.keys(problems).length > 0 || codRefused) {
      setFormError('Please correct the highlighted fields.')
      return
    }
    if (!settled || !quote) return
    setTotalChanged(null)

    const onSuccess = (saved: WebOrder) => {
      idempotency.settle()
      toast.success(isEdit ? `${saved.number} updated.` : `Order ${saved.number} placed.`)
      navigate(`/web-orders/${saved.id}`)
    }

    if (isEdit && order) {
      const input = editBodyFrom(draft, shippingMethodId, quote.total)
      edit.mutate({ id: order.id, input, idempotencyKey: idempotency.keyFor({ id: order.id, input }) }, { onSuccess, onError })
    } else {
      const input = createBodyFrom(draft, { shippingMethodId, paymentMethod: paymentMethod as WebPaymentMethod }, quote.total)
      create.mutate({ input, idempotencyKey: idempotency.keyFor(input) }, { onSuccess, onError })
    }
  }

  const backTo = isEdit && order ? `/web-orders/${order.id}` : '/web-orders'
  const currency = quote?.currency ?? order?.currency ?? undefined

  return (
    <form noValidate onSubmit={submit} className="mx-auto flex w-full max-w-6xl flex-col gap-6" aria-label={isEdit ? 'Change order' : 'New order'}>
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild variant="ghost" size="icon" aria-label={isEdit ? 'Back to the order' : 'Back to web orders'}><Link to={backTo}><ArrowLeftIcon /></Link></Button>
        <h1 className="text-2xl font-semibold tracking-tight">{isEdit && order ? <>Change order <span className="font-mono">{order.number}</span></> : 'New order'}</h1>
      </div>
      <p className="-mt-4 text-sm text-muted-foreground">
        {isEdit
          ? 'Prices and offers are worked out again from today’s prices. The customer is not sent a new message.'
          : 'For orders taken by phone, Facebook, WhatsApp and other chats. The order then follows the usual web order steps.'}
      </p>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-6">
          <Section title="Customer">
            {draft.customer ? (
              <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 p-2 text-sm" data-testid="linked-customer">
                <UserIcon className="size-4 text-muted-foreground" aria-hidden />
                <span>Linked to customer <span className="font-medium">{draft.customer.name}</span>{draft.customer.code && <span className="text-muted-foreground"> ({draft.customer.code})</span>}</span>
                {!isEdit && (
                  <Button type="button" variant="ghost" size="sm" className="ml-auto" onClick={() => set({ customer: null })}>
                    <XIcon data-icon="inline-start" /> Unlink
                  </Button>
                )}
              </div>
            ) : (
              !isEdit && can('customers.view') && (
                <div className="flex flex-wrap items-center gap-2">
                  <CustomerSearch onSelect={(c) => update(withCustomer(draft, c))} />
                  <span className="text-sm text-muted-foreground">or type a new customer’s details.</span>
                </div>
              )
            )}
            {errors.customer_id && <ErrorText>{errors.customer_id}</ErrorText>}
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Name" error={errors['contact.name']}>
                <Input value={draft.contact.name} maxLength={120} autoComplete="off" onChange={(e) => update(withContact(draft, { name: e.target.value }))} />
              </FormField>
              <FormField label="Mobile number" error={errors['contact.phone']}>
                <Input value={draft.contact.phone} inputMode="tel" placeholder="01XXXXXXXXX" autoComplete="off" onChange={(e) => update(withContact(draft, { phone: e.target.value }))} />
              </FormField>
              <FormField label="E-mail (optional)" error={errors['contact.email']} hint="For the order confirmation e-mail." className="sm:col-span-2">
                <Input type="email" value={draft.contact.email} maxLength={190} autoComplete="off" onChange={(e) => update(withContact(draft, { email: e.target.value }))} />
              </FormField>
            </div>
            {can('web_orders.view') && <PhoneHistoryStrip phone={contactPhone} />}
          </Section>

          <Section title="Products">
            {can('products.view') ? (
              <div className="max-w-md">
                <VariantPicker value={null} aria-label="Add a product" onChange={(o) => update(withLineAdded(draft, { variant_id: o.id, label: o.label, sku: o.sku }))} />
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">You need permission to view products to add new ones.</p>
            )}
            {errors.lines && <ErrorText>{errors.lines}</ErrorText>}
            {draft.lines.length === 0 ? (
              <p className="text-sm text-muted-foreground">No products yet.</p>
            ) : (
              <ul className="flex flex-col divide-y rounded-md border" aria-label="Order lines">
                {draft.lines.map((line, i) => {
                  const priced = quoteLine(line.variant_id)
                  const issue = lineIssue(priced)
                  const qtyError = errors[`lines.${i}.quantity`] ?? errors[`lines.${i}.variant_id`]
                  return (
                    <li key={line.variant_id} className="flex flex-wrap items-start gap-3 p-3" data-testid={`line-${line.variant_id}`}>
                      <div className="min-w-0 flex-1 basis-48">
                        <div className="font-medium">{line.label}</div>
                        <div className="text-xs text-muted-foreground">
                          {line.sku && <span className="font-mono">{line.sku}</span>}
                          {priced && <> · {formatMoney(priced.unit_price)} each</>}
                          {priced && priced.available !== null && priced.available !== undefined && <> · {trimDecimal(priced.available)} in stock</>}
                        </div>
                        {issue && <p className="mt-1 flex items-center gap-1 text-sm text-destructive" role="alert"><AlertTriangleIcon className="size-4" aria-hidden />{issue}</p>}
                        {qtyError && <ErrorText>{qtyError}</ErrorText>}
                      </div>
                      <div className="flex items-center gap-2">
                        <Label htmlFor={`qty-${i}`} className="sr-only">Quantity of {line.label}</Label>
                        <Input
                          id={`qty-${i}`}
                          className="w-24 text-right"
                          inputMode="decimal"
                          value={line.quantity}
                          aria-invalid={qtyError || issue ? true : undefined}
                          onChange={(e) => set({ lines: draft.lines.map((l, j) => (j === i ? { ...l, quantity: e.target.value } : l)) })}
                        />
                        <span className="w-28 text-right font-mono text-sm" data-testid="line-total">{priced ? formatMoney(priced.line_total) : '—'}</span>
                        <Button type="button" variant="ghost" size="icon" aria-label={`Remove ${line.label}`} onClick={() => set({ lines: draft.lines.filter((_, j) => j !== i) })}>
                          <Trash2Icon />
                        </Button>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </Section>

          <Section title="Delivery">
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Recipient name" error={errors['address.recipient_name']}>
                <Input value={draft.address.recipient_name} maxLength={120} autoComplete="off" onChange={(e) => update({ ...draft, recipientEdited: true, address: { ...draft.address, recipient_name: e.target.value } })} />
              </FormField>
              <FormField label="Recipient mobile" error={errors['address.phone']}>
                <Input value={draft.address.phone} inputMode="tel" placeholder="01XXXXXXXXX" autoComplete="off" onChange={(e) => update({ ...draft, recipientEdited: true, address: { ...draft.address, phone: e.target.value } })} />
              </FormField>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="order-division">Division</Label>
                <Select value={draft.address.division_id !== null ? String(draft.address.division_id) : ''} onValueChange={(v) => setAddress({ division_id: Number(v), district_id: null })}>
                  <SelectTrigger id="order-division" className="w-full" aria-invalid={errors['address.division_id'] ? true : undefined}><SelectValue placeholder="Choose a division" /></SelectTrigger>
                  <SelectContent>
                    {divisionList.map((d) => <SelectItem key={d.id} value={String(d.id)}>{d.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                {errors['address.division_id'] && <ErrorText>{errors['address.division_id']}</ErrorText>}
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="order-district">District</Label>
                <Select value={draft.address.district_id !== null ? String(draft.address.district_id) : ''} onValueChange={(v) => setAddress({ district_id: Number(v) })} disabled={draft.address.division_id === null}>
                  <SelectTrigger id="order-district" className="w-full" aria-invalid={errors['address.district_id'] ? true : undefined}><SelectValue placeholder="Choose a district" /></SelectTrigger>
                  <SelectContent>
                    {districtList.map((d) => <SelectItem key={d.id} value={String(d.id)}>{d.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                {errors['address.district_id'] && <ErrorText>{errors['address.district_id']}</ErrorText>}
              </div>
              <FormField label="Area (optional)" error={errors['address.area']}>
                <Input value={draft.address.area} maxLength={120} onChange={(e) => setAddress({ area: e.target.value })} />
              </FormField>
              <FormField label="Postcode (optional)" error={errors['address.postcode']}>
                <Input value={draft.address.postcode} maxLength={10} inputMode="numeric" onChange={(e) => setAddress({ postcode: e.target.value })} />
              </FormField>
              <FormField label="Address" error={errors['address.address_line']} className="sm:col-span-2">
                <Input value={draft.address.address_line} maxLength={255} placeholder="House, road, village…" onChange={(e) => setAddress({ address_line: e.target.value })} />
              </FormField>
            </div>

            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1.5 text-sm font-medium">Delivery method</legend>
              {!quote || draft.address.district_id === null ? (
                <p className="text-sm text-muted-foreground">Add a product and choose the district to see the delivery methods.</p>
              ) : quote.shipping_methods.length === 0 ? (
                <p className="text-sm text-destructive">No delivery method serves this district.</p>
              ) : (
                quote.shipping_methods.map((m) => {
                  const eta = etaLabel(m.eta_min_days, m.eta_max_days)
                  return (
                    <label key={m.id} className="flex cursor-pointer items-start gap-2 rounded-md border p-2 text-sm has-[:checked]:border-primary">
                      <input type="radio" name="shipping-method" className="mt-0.5 size-4 accent-primary" checked={shippingMethodId === m.id} onChange={() => set({ shipping_method_id: m.id })} />
                      <span className="flex-1">
                        <span className="font-medium">{m.name}</span>
                        <span className="block text-xs text-muted-foreground">
                          {[eta, m.free_over ? `free from ${formatMoney(m.free_over)}` : null, m.cod_allowed ? null : 'no cash on delivery'].filter(Boolean).join(' · ')}
                        </span>
                      </span>
                      <span className="font-mono">{isZeroDecimal(m.fee) ? 'Free' : formatMoney(m.fee)}</span>
                    </label>
                  )
                })
              )}
              {errors.shipping_method_id && <ErrorText>{errors.shipping_method_id}</ErrorText>}
            </fieldset>
          </Section>

          <Section title="Payment and notes">
            {isEdit ? (
              <p className="text-sm"><span className="text-muted-foreground">Payment:</span> <span className="font-medium">{order?.payment_method_label}</span> <span className="text-muted-foreground">(cannot be changed)</span></p>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                <fieldset className="flex flex-col gap-2">
                  <legend className="mb-1.5 text-sm font-medium">Payment</legend>
                  {!quote ? (
                    <p className="text-sm text-muted-foreground">Add a product to see the payment methods.</p>
                  ) : quote.payment_methods.length === 0 ? (
                    <p className="text-sm text-destructive">No payment method is turned on for online orders.</p>
                  ) : (
                    quote.payment_methods.map((m) => (
                      <label key={m.code} className="flex cursor-pointer items-center gap-2 text-sm">
                        <input type="radio" name="payment-method" className="size-4 accent-primary" checked={paymentMethod === m.code} onChange={() => set({ payment_method: m.code })} />
                        {m.name || paymentMethodLabel(m.code)}
                      </label>
                    ))
                  )}
                  {isSendMoneyCode(paymentMethod) && (
                    <p className="text-sm text-muted-foreground" data-testid="send-money-note">The order waits as Awaiting payment until you confirm the customer's transaction ID on the order page.</p>
                  )}
                  {errors.payment_method && <ErrorText>{errors.payment_method}</ErrorText>}
                </fieldset>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="order-channel">Order came by</Label>
                  <Select value={draft.channel} onValueChange={(v) => set({ channel: v as OrderChannel })}>
                    <SelectTrigger id="order-channel" className="w-full" aria-invalid={errors.channel ? true : undefined}><SelectValue placeholder="Choose" /></SelectTrigger>
                    <SelectContent>
                      {ORDER_CHANNELS.map((c) => <SelectItem key={c} value={c}>{CHANNEL_LABELS[c]}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  {errors.channel && <ErrorText>{errors.channel}</ErrorText>}
                </div>
              </div>
            )}
            <FormField
              label="Coupon code (optional)"
              error={errors.coupon_code ?? (quote?.coupon && !quote.coupon.applied && draft.coupon_code.trim() ? (quote.coupon.message ?? 'This coupon does not apply to this order.') : undefined)}
              hint={quote?.coupon_code && quote.coupon?.applied ? `Applied${quote.coupon.promotion_name ? `: ${quote.coupon.promotion_name}` : ''}.` : undefined}
            >
              <Input className="max-w-xs font-mono" value={draft.coupon_code} maxLength={50} autoComplete="off" onChange={(e) => set({ coupon_code: e.target.value })} />
            </FormField>
            <FormField label="Note (optional)" error={errors.notes} hint="Printed on the packing slip.">
              <Textarea value={draft.notes} maxLength={NOTES_MAX} rows={2} onChange={(e) => set({ notes: e.target.value })} />
            </FormField>
            {isEdit && (
              <FormField label="Reason for the change (optional)" error={errors.reason} hint="Kept in the order’s change history.">
                <Input value={draft.reason} maxLength={REASON_MAX} onChange={(e) => set({ reason: e.target.value })} />
              </FormField>
            )}
          </Section>
        </div>

        <Card className="lg:sticky lg:top-4">
          <CardHeader><CardTitle>Totals</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-4">
            {!quoteInput ? (
              <p className="text-sm text-muted-foreground">Add a product to see the totals.</p>
            ) : quoteQuery.error && !quote ? (
              <p role="alert" className="text-sm text-destructive">The totals could not be worked out: {quoteQuery.error.message}</p>
            ) : !quote ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2Icon className="size-4 animate-spin" /> Working out the totals…</p>
            ) : (
              <dl className="grid grid-cols-[1fr_auto] gap-y-1 text-sm" aria-label="Order totals" aria-busy={!settled}>
                <dt className="text-muted-foreground">Subtotal</dt><dd className="text-right font-mono">{formatMoney(quote.subtotal)}</dd>
                {quote.promotions.filter((p) => p.kind !== 'shipping').map((p, i) => (
                  <PromotionRow key={i} name={p.name} detail={promotionKindLabel(p.kind)} amount={p.amount} />
                ))}
                <dt className="text-muted-foreground">{quote.prices_include_tax ? 'VAT (included)' : 'VAT'}</dt><dd className="text-right font-mono">{formatMoney(quote.tax_total)}</dd>
                <dt className="text-muted-foreground">Delivery{!isZeroDecimal(quote.shipping_discount) && <span className="block text-xs">{formatMoney(quote.shipping_discount)} waived</span>}</dt>
                <dd className="text-right font-mono">{shippingMethodId ? (isZeroDecimal(quote.shipping_total) ? 'Free' : formatMoney(quote.shipping_total)) : '—'}</dd>
                {!isZeroDecimal(quote.cod_fee) && <><dt className="text-muted-foreground">Cash on delivery fee</dt><dd className="text-right font-mono">{formatMoney(quote.cod_fee)}</dd></>}
                <dt className="font-semibold">Total</dt><dd className="text-right font-mono font-semibold" data-testid="quote-total">{formatMoney(quote.total, currency)}</dd>
              </dl>
            )}
            {quoteQuery.error && quote && <p className="text-xs text-destructive">Could not update the totals: {quoteQuery.error.message}</p>}
            {!settled && quote && !quoteQuery.error && <p className="flex items-center gap-1 text-xs text-muted-foreground"><Loader2Icon className="size-3 animate-spin" /> Updating…</p>}

            {totalChanged && (
              <div role="alert" className="rounded-md border border-warning/40 bg-warning/10 p-2 text-sm" data-testid="total-changed">
                <p className="font-medium">The total changed to {formatMoney(totalChanged.to, currency)}.</p>
                <p>Prices or offers changed since the totals were worked out (it was {formatMoney(totalChanged.from, currency)}). Check the order, then {isEdit ? 'save' : 'place it'} again.</p>
              </div>
            )}
            {formError && !totalChanged && (
              <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-sm">
                <p>{formError}</p>
                {otherErrors.length > 0 && <ul className="mt-1 list-disc pl-5">{otherErrors.map(([k, m]) => <li key={k}>{m}</li>)}</ul>}
              </div>
            )}

            <Button type="submit" disabled={saving || (quoteInput !== null && !settled)}>
              {saving && <Loader2Icon data-icon="inline-start" className="animate-spin" />}
              {isEdit ? 'Save changes' : 'Place order'}
            </Button>
            {!isEdit && paymentMethod === 'cod' && (
              <p className="text-xs text-muted-foreground"><Badge variant="info">COD</Badge> Orders you enter are confirmed straight away: you have spoken with the customer.</p>
            )}
            <Button asChild variant="ghost"><Link to={backTo}>Cancel</Link></Button>
          </CardContent>
        </Card>
      </div>
    </form>
  )
}

function PromotionRow({ name, detail, amount }: { name: string; detail: string; amount: string }) {
  return (
    <>
      <dt className="text-muted-foreground">{name}<span className="block text-xs">{detail}</span></dt>
      <dd className="text-right font-mono text-success-soft-foreground">−{formatMoney(amount)}</dd>
    </>
  )
}
