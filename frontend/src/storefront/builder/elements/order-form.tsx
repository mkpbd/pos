import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CircleAlertIcon, CircleCheckIcon, Loader2Icon, PackageCheckIcon, TruckIcon } from 'lucide-react'
import { ApiError } from '@/lib/api/client'
import { isZeroDecimal } from '@/lib/money'
import { cn } from '@/lib/utils'
import { loginPathFor } from '../../account/safe-next'
import { currentPrice } from '../../cart/add-several'
import { displayQuantity } from '../../cart/quantity'
import { QuantityStepper } from '../../cart/quantity-stepper'
import { Price } from '../../catalog/price'
import { ProductImage } from '../../catalog/product-image'
import { chooseValue, initialSelection, variantFor, type Selection } from '../../catalog/variant-selection'
import { VariantSelector } from '../../catalog/variant-selector'
import { etaLabel } from '../../checkout/delivery'
import { PlacementAttempts } from '../../checkout/placement-attempt'
import { SummaryTotals } from '../../checkout/summary-totals'
import { useDebouncedValue } from '../../checkout/use-debounced-value'
import { storeApi } from '../../http'
import type { MessageKey } from '../../i18n/en'
import { useLocale } from '../../i18n/locale'
import { readAttribution } from '../../landing/attribution'
import { directKeys, fetchDirectPreview, useDirectOrderMutation, useDirectPreviewQuery } from '../../landing/direct-api'
import { ORDER_PLACED_EVENT, orderFormAnchor } from '../../landing/order-now-shared'
import {
  EMPTY_VALUES,
  freshPreview,
  maxQuantity,
  ORDER_FORM_FIELDS,
  orderFormErrors,
  orderFormFieldFor,
  orderLines,
  orderLink,
  orderProblem,
  startVariant,
  toDirectOrderInput,
  toDirectPreviewInput,
  upsellVariant,
  type DirectPlacedOrder,
  type GeoIdLookup,
  type OrderFormField,
  type OrderFormRules,
  type OrderFormValues,
  type OrderProblem,
} from '../../landing/order-form-logic'
import { formatPrice } from '../../money'
import { customerKeys, localized } from '../../store-keys'
import type { CheckoutPreview, Customer, GeoDistrict, GeoDivision, ProductDetail, ShippingMethod } from '../../types'
import { DraftPlaceholder, PreviewMark } from '../preview-mark'
import { NODE_ID } from '../registry'
import { useOwnerDocumentId, usePage } from '../render-context'
import type { OrderFormData } from '../types'
import { isUuid, oneOf, ORDER_FORM_ENUMS } from '../validate'
import { useB8aData } from './b8a-shared'
import { isOrderFormData } from './guards'
import { isObject, str, type El } from './shared'

/*
 * P2a: the one-product order form. Most shoppers come from a Facebook ad on a phone and pay cash
 * on delivery, so the form is one short page: option and quantity (and an optional add-on), name,
 * mobile number, district and address, delivery and payment, and a live summary the server
 * recomputes (POST /store/checkout/direct/preview). "Confirm order" places the order directly
 * (POST /store/checkout/direct, idempotent: a retry after a lost connection never orders twice)
 * without touching the shopper's cart, then shows a thank-you with the order link. Visible labels,
 * errors tied to their fields, an error summary that takes the focus, large tap targets. In a
 * draft preview or the editor canvas the form is drawn but places nothing.
 */

export const PREVIEW_DEBOUNCE_MS = 250

const INPUT =
  'w-full min-h-12 rounded-lg border border-sf-border bg-sf-surface px-4 py-2.5 text-base text-sf-heading placeholder:text-sf-text/70 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sf-accent aria-[invalid=true]:border-sf-sale disabled:opacity-60'
const SECTION = 'flex flex-col gap-4'
const HEADING = 'font-heading text-lg font-bold text-sf-heading'
const RADIO_CARD =
  'flex min-h-12 cursor-pointer items-start gap-3 rounded-lg border-2 border-sf-border bg-sf-surface p-3.5 transition has-checked:border-sf-accent has-checked:bg-sf-accent/5 has-focus-visible:outline-2 has-focus-visible:outline-sf-accent'
const CONFIRM =
  'sf-button inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-sf-button bg-sf-button px-6 py-3 text-lg font-extrabold tracking-wide text-sf-button-foreground transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60'

export function OrderFormElement({ element }: { element: El<'order_form'> }) {
  const { data, state, draft } = useB8aData(element.id, isOrderFormData)
  if (!data) return <DraftPlaceholder element={element} />
  if (state && !draft) return null
  return (
    <PreviewMark state={state}>
      <OrderFormBody element={element} data={data} />
    </PreviewMark>
  )
}

/** The field labels of the error summary. */
const FIELD_LABELS: Record<OrderFormField, MessageKey> = {
  variant: 'landing.orderForm.option',
  quantity: 'landing.orderForm.quantity',
  name: 'landing.orderForm.name',
  phone: 'landing.orderForm.phone',
  email: 'landing.orderForm.email',
  division_id: 'checkout.address.division',
  district_id: 'checkout.address.district',
  area: 'landing.orderForm.area',
  address_line: 'landing.orderForm.addressLine',
  shipping_method_id: 'landing.orderForm.delivery',
  payment_method: 'landing.orderForm.payment',
  note: 'landing.orderForm.note',
}

type Errors = Partial<Record<OrderFormField, string>>

/** Geography for the address pickers (not fetched in the editor canvas). */
function useGeo(enabled: boolean, divisionId: string) {
  const { locale } = useLocale()
  const divisions = useQuery({
    queryKey: localized(customerKeys.divisions, locale),
    queryFn: ({ signal }) => storeApi.get<GeoDivision[]>('/store/geo/divisions', { signal }).then((r) => r.data),
    staleTime: Infinity,
    enabled,
  })
  const districts = useQuery({
    queryKey: localized(customerKeys.districts(divisionId), locale),
    queryFn: ({ signal }) => storeApi.get<GeoDistrict[]>('/store/geo/districts', { signal, query: { division: divisionId } }).then((r) => r.data),
    enabled: enabled && divisionId !== '',
    staleTime: Infinity,
  })
  return { divisions, districts }
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) ? Math.min(max, Math.max(min, value)) : fallback
}

function OrderFormBody({ element, data }: { element: El<'order_form'>; data: OrderFormData }) {
  const uid = useId()
  const { t, translateMessage, digits, locale } = useLocale()
  const { page, draft } = usePage()
  const { pathname } = useLocation()
  const queryClient = useQueryClient()
  const p = (element.props ?? {}) as Partial<El<'order_form'>['props']>
  const product: ProductDetail = data.product
  const canvas = page.document?.key === 'canvas'
  // B9: inside a global section, the global document (the server finds the element there).
  const documentId = useOwnerDocumentId()
  // Placing needs the published document (its uuid) and an element id the server can find.
  const inactive = draft || canvas || !isUuid(documentId) || !NODE_ID.test(element.id)

  const rules: OrderFormRules = {
    email: (isObject(p.fields) && oneOf(p.fields.email, ORDER_FORM_ENUMS.email)) || 'optional',
    note: (isObject(p.fields) && oneOf(p.fields.note, ORDER_FORM_ENUMS.note)) || 'optional',
  }
  const codOnly = p.payment !== 'store_methods'
  const twoColumns = p.layout === 'two_columns'
  const title = str(p.title).trim()
  const text = str(p.text).trim()
  const buttonLabel = str(p.button_label).trim() || t('landing.orderForm.defaultButton')
  const successMessage = str(p.success_message).trim()

  // Product, option and quantity.
  const showVariants = p.show_variants !== false && product.options.length > 0
  const [selection, setSelection] = useState<Selection>(() => initialSelection(product, startVariant(product)?.id))
  const variant = showVariants ? variantFor(product, selection) : startVariant(product)
  const quantityLimit = isObject(p.quantity) ? clampInt(p.quantity.max, 1, 20, 10) : 10
  const qMax = maxQuantity(quantityLimit, variant)
  const qDefault = isObject(p.quantity) ? clampInt(p.quantity.default, 1, 10, 1) : 1
  const [quantity, setQuantity] = useState(() => String(Math.min(qDefault, qMax)))
  const qty = Math.min(qMax, Math.max(1, Number.parseInt(quantity, 10) || 1))
  const image = (variant?.image_id ? product.images.find((img) => img.id === variant.image_id) : null) ?? product.images[0] ?? null

  // The optional add-on (always one).
  const upsellProduct = isObject(p.upsell) ? (data.upsell ?? null) : null
  const upsell = upsellVariant(upsellProduct)
  const upsellLabel = isObject(p.upsell) ? str(p.upsell.label).trim() : ''
  const [withUpsell, setWithUpsell] = useState(false)

  // Payment methods offered (cod_only: cash on delivery only).
  const paymentMethods = (Array.isArray(data.payment_methods) ? data.payment_methods : []).filter((m) => isObject(m) && (m.code === 'cod' || m.code === 'bank_transfer') && (!codOnly || m.code === 'cod'))
  const [values, setValues] = useState<OrderFormValues>(() => ({ ...EMPTY_VALUES, payment_method: paymentMethods.length === 1 ? paymentMethods[0]!.code : '' }))
  const set = (field: keyof OrderFormValues, value: string) => setValues((v) => ({ ...v, [field]: value }))

  const { divisions, districts } = useGeo(!canvas, values.division_id)
  const geoId: GeoIdLookup = (kind, value) => {
    const list: { id: GeoDivision['id'] }[] | undefined = kind === 'division' ? divisions.data : districts.data
    return list?.find((item) => String(item.id) === value)?.id ?? value
  }
  const servedDistricts = isObject(data.shipping) && isObject(data.shipping.districts) ? (data.shipping.districts as Record<string, string[]>) : null

  // The live summary.
  const unavailable = data.checkout_available === false || paymentMethods.length === 0
  // Only a store that requires an account asks who is signed in (never from the editor canvas).
  const me = useQuery({
    queryKey: localized(customerKeys.me, locale),
    queryFn: ({ signal }) => storeApi.get<Customer | null>('/store/account/me', { signal }).then((r) => r.data ?? null),
    staleTime: 5 * 60_000,
    enabled: !canvas && data.guest_checkout === false,
  })
  const needsSignIn = data.guest_checkout === false && !me.data
  const lines = orderLines(variant?.in_stock ? variant : null, qty, withUpsell ? upsell : null)
  const base = { documentId: String(documentId ?? ''), elementId: element.id, lines }
  const previewInput = toDirectPreviewInput(base, values, geoId)
  const [settledInput, debouncing] = useDebouncedValue(previewInput, PREVIEW_DEBOUNCE_MS)
  const preview = useDirectPreviewQuery(settledInput, !inactive && !unavailable && settledInput.lines.length > 0)
  const current = preview.isPlaceholderData ? null : (preview.data ?? null)
  const shown = preview.data ?? null
  const updating = debouncing || preview.isFetching
  const deliveryPending = !settledInput.address
  const methods = deliveryPending ? [] : (shown?.shipping_methods ?? [])
  const selectedMethod = methods.find((m) => m.id === values.shipping_method_id) ?? null
  const currency = shown?.currency ?? null

  // Take the server's delivery choice when ours is not offered for this district (adjusted while rendering).
  if (current && Array.isArray(current.shipping_methods)) {
    const offered = current.shipping_methods
    if (!offered.some((m) => m.id === values.shipping_method_id)) {
      const next = current.shipping_method_id && offered.some((m) => m.id === current.shipping_method_id) ? current.shipping_method_id : offered.length === 1 ? offered[0]!.id : ''
      if (next !== values.shipping_method_id) setValues((v) => ({ ...v, shipping_method_id: next }))
    }
  }
  // Cash on delivery is not offered by every delivery method.
  if (values.payment_method === 'cod' && selectedMethod && !selectedMethod.cod_allowed && paymentMethods.length > 1) setValues((v) => ({ ...v, payment_method: '' }))

  // Placing the order.
  const place = useDirectOrderMutation()
  const [attempts] = useState(() => new PlacementAttempts())
  const [errors, setErrors] = useState<Errors>({})
  const [problem, setProblem] = useState<OrderProblem | null>(null)
  const [placed, setPlaced] = useState<{ order: DirectPlacedOrder; name: string } | null>(null)
  const [failures, setFailures] = useState(0)
  const summaryRef = useRef<HTMLDivElement>(null)
  const problemRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (failures === 0) return
    ;(summaryRef.current ?? problemRef.current)?.focus()
  }, [failures])

  const fail = (next: Errors, nextProblem: OrderProblem | null) => {
    setErrors(next)
    setProblem(nextProblem)
    setFailures((n) => n + 1)
  }

  const [checking, setChecking] = useState(false)
  const busy = checking || place.isPending

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (inactive || busy || unavailable) return
    const local = orderFormErrors(values, rules, variant)
    if (Object.keys(local).length > 0) return fail(local, null)
    if (needsSignIn) return fail({}, { code: 'SIGN_IN', message: t('landing.orderForm.problem.signIn'), link: { to: loginPathFor(pathname), label: t('checkout.problem.signIn') } })
    // The total of exactly what is ordered (the summary may still be catching up with the last change).
    setChecking(true)
    let priced: CheckoutPreview
    try {
      priced = await fetchDirectPreview(queryClient, previewInput, locale)
    } catch (error) {
      setChecking(false)
      return fail({}, orderProblem(error, t, pathname))
    }
    setChecking(false)
    if (priced.issues.length > 0) return fail({ quantity: 'landing.orderForm.issues' }, { code: 'ITEMS_UNAVAILABLE', message: t('landing.orderForm.problem.itemsUnavailable') })
    setErrors({})
    setProblem(null)
    const input = toDirectOrderInput(base, values, rules, priced.total, geoId, readAttribution())
    const idempotencyKey = attempts.keyFor(input)
    place.mutate(
      { input, idempotencyKey },
      {
        onSuccess: (order) => {
          attempts.reset()
          setPlaced({ order, name: input.contact.name })
          window.dispatchEvent(new CustomEvent(ORDER_PLACED_EVENT, { detail: element.id }))
        },
        onError: (error) => {
          attempts.settle(error)
          const result = orderProblem(error, t, pathname)
          const fresh = freshPreview(error)
          if (fresh) {
            queryClient.setQueryData<CheckoutPreview>(localized(directKeys.preview(previewInput), locale), fresh)
          } else if (error instanceof ApiError && ['TOTAL_CHANGED', 'ITEMS_UNAVAILABLE', 'INSUFFICIENT_STOCK', 'SHIPPING_UNAVAILABLE', 'PAYMENT_METHOD_UNAVAILABLE'].includes(error.code)) {
            void queryClient.invalidateQueries({ queryKey: directKeys.previewAll })
          }
          const next: Errors = {}
          if (error instanceof ApiError && error.code === 'VALIDATION_FAILED') {
            for (const [key, messages] of Object.entries(error.fieldErrors)) {
              const field = orderFormFieldFor(key)
              if (field && messages[0] && !next[field]) next[field] = messages[0]
            }
          } else if (result.field) next[result.field] = result.message
          if (error instanceof ApiError && error.code === 'TOTAL_CHANGED' && fresh) {
            result.message = t('checkout.problem.totalChangedFrom', { from: formatPrice(input.expected_total, fresh.currency ?? currency), to: formatPrice(fresh.total, fresh.currency ?? currency) })
          }
          if (error instanceof ApiError && error.code === 'VALIDATION_FAILED') {
            // Field errors go to their fields; one the form does not show becomes the message.
            const first = Object.values(error.fieldErrors)[0]?.[0]
            return fail(next, Object.keys(next).length > 0 ? null : { ...result, message: first ?? result.message })
          }
          fail(next, result)
        },
      },
    )
  }

  const id = (field: string, part = '') => `${uid}-${field}${part}`
  const errorText = (field: OrderFormField) => (errors[field] ? digits(translateMessage(errors[field]!)) : undefined)
  const errorFields = ORDER_FORM_FIELDS.filter((field) => errors[field])
  const describedBy = (field: OrderFormField, hint?: boolean) => cn(hint && id(field, '-hint'), errors[field] && id(field, '-error')) || undefined
  const fieldError = (field: OrderFormField) =>
    errors[field] ? (
      <p id={id(field, '-error')} className="text-sm font-medium text-sf-sale">
        {errorText(field)}
      </p>
    ) : null
  const focusField = (field: OrderFormField) => {
    const target = document.getElementById(id(field))
    const input = target instanceof HTMLFieldSetElement || target?.tagName === 'DIV' ? target.querySelector<HTMLElement>('input, select, button') : target
    input?.focus()
  }

  const confirming = problem?.code === 'TOTAL_CHANGED'

  if (placed) {
    return (
      <div data-b={element.id} id={orderFormAnchor(element.id)} tabIndex={-1} className="b-order-form @container scroll-mt-24 focus:outline-none" data-testid="order-form">
        <ThankYou placed={placed.order} name={placed.name} message={successMessage} />
      </div>
    )
  }

  const textField = (field: 'name' | 'phone' | 'email' | 'area' | 'address_line', label: string, extra: { type?: string; autoComplete?: string; inputMode?: 'tel' | 'email' | 'text'; placeholder?: string; maxLength: number; hint?: string; required?: boolean }) => (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id(field)} className="text-sm font-semibold text-sf-heading">
        {label}
        {extra.required && <RequiredMark />}
      </label>
      <input
        id={id(field)}
        type={extra.type ?? 'text'}
        value={values[field]}
        onChange={(e) => set(field, e.target.value)}
        autoComplete={extra.autoComplete}
        inputMode={extra.inputMode}
        placeholder={extra.placeholder}
        maxLength={extra.maxLength}
        aria-invalid={errors[field] ? true : undefined}
        aria-required={extra.required || undefined}
        aria-describedby={describedBy(field, Boolean(extra.hint))}
        className={INPUT}
      />
      {extra.hint && (
        <p id={id(field, '-hint')} className="text-sm">
          {extra.hint}
        </p>
      )}
      {fieldError(field)}
    </div>
  )

  const geoSelect = (field: 'division_id' | 'district_id', label: string, options: { id: GeoDivision['id']; name: string; name_bn: string | null }[] | undefined, placeholder: string, disabled: boolean) => (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id(field)} className="text-sm font-semibold text-sf-heading">
        {label}
        <RequiredMark />
      </label>
      <select
        id={id(field)}
        value={values[field]}
        disabled={disabled}
        onChange={(e) => setValues((v) => ({ ...v, [field]: e.target.value, ...(field === 'division_id' ? { district_id: '' } : {}) }))}
        aria-invalid={errors[field] ? true : undefined}
        aria-required
        aria-describedby={describedBy(field)}
        className={cn(INPUT, 'appearance-auto')}
      >
        <option value="">{placeholder}</option>
        {options?.map((option) => {
          const served = field !== 'district_id' || !servedDistricts || Object.keys(servedDistricts).length === 0 || Object.hasOwn(servedDistricts, String(option.id))
          return (
            <option key={String(option.id)} value={String(option.id)}>
              {option.name}
              {option.name_bn && option.name_bn !== option.name ? ` (${option.name_bn})` : ''}
              {served ? '' : ` — ${t('landing.orderForm.noDelivery')}`}
            </option>
          )
        })}
      </select>
      {fieldError(field)}
    </div>
  )

  const productPanel = (
    <section aria-labelledby={id('product-heading')} className={cn(SECTION, 'rounded-sf-card border border-sf-border bg-sf-surface p-4')}>
      <h3 id={id('product-heading')} className="sr-only">
        {t('landing.orderForm.product')}
      </h3>
      <div className="flex items-start gap-3">
        <ProductImage image={image} alt="" className="size-20 shrink-0 rounded-lg border" />
        <div className="flex min-w-0 flex-col gap-1">
          <p className="font-bold text-sf-heading">{product.name}</p>
          {variant && <Price price={currentPrice(variant)} compareAt={variant.promo_price ? variant.price : variant.compare_at_price} size="md" />}
          {variant && !variant.in_stock && <p className="text-sm font-semibold text-sf-sale">{t('landing.orderForm.errorSoldOut')}</p>}
        </div>
      </div>
      {showVariants && (
        <div id={id('variant')} className="flex flex-col gap-1.5">
          <VariantSelector product={product} selection={selection} onChoose={(option, value) => setSelection((s) => chooseValue(product, s, option, value))} />
          {fieldError('variant')}
        </div>
      )}
      {!showVariants && fieldError('variant')}
      <div id={id('quantity')} className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-sm font-semibold text-sf-heading" aria-hidden>
          {t('landing.orderForm.quantity')}
        </span>
        <QuantityStepper value={String(qty)} onChange={(next) => setQuantity(next)} max={String(qMax)} disabled={!variant?.in_stock} label={t('landing.orderForm.quantityOf', { name: product.name })} />
      </div>
      {fieldError('quantity')}
      {upsell && upsellProduct && upsellLabel && (
        <label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-lg border-2 border-dashed border-sf-accent/60 p-3 has-checked:border-solid has-checked:border-sf-accent has-checked:bg-sf-accent/5" data-testid="order-form-upsell">
          <input type="checkbox" checked={withUpsell} onChange={(e) => setWithUpsell(e.target.checked)} className="size-5 shrink-0 accent-sf-accent" />
          <ProductImage image={upsellProduct.images[0] ?? null} alt="" className="size-12 shrink-0 rounded-md border" />
          <span className="min-w-0 flex-1">
            <span className="block font-semibold text-sf-heading">{upsellLabel}</span>
            <span className="block text-sm">{t('landing.orderForm.upsellPrice', { price: formatPrice(currentPrice(upsell), currency) })}</span>
          </span>
        </label>
      )}
    </section>
  )

  const summaryPanel = (
    <OrderSummary
      preview={shown}
      error={preview.error}
      updating={updating}
      deliveryPending={deliveryPending}
      currency={currency}
      inactive={inactive}
      onRetry={() => void preview.refetch()}
    />
  )

  return (
    <div data-b={element.id} id={orderFormAnchor(element.id)} tabIndex={-1} className="b-order-form @container scroll-mt-24 focus:outline-none" data-testid="order-form">
      <div className="flex flex-col gap-5 rounded-sf-card bg-sf-surface/0">
        {(title || text) && (
          <div className="flex flex-col gap-1">
            {title && <h2 className="font-heading text-2xl font-extrabold text-sf-heading">{title}</h2>}
            {text && <p className="whitespace-pre-line">{text}</p>}
          </div>
        )}
        <form noValidate onSubmit={(event) => void submit(event)} aria-label={title || t('landing.orderForm.label')} className={cn('grid items-start gap-5', twoColumns && '@3xl:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]')}>
          <div className={cn('flex min-w-0 flex-col gap-5', twoColumns && '@3xl:col-start-2 @3xl:row-start-1')}>
            {productPanel}
            {twoColumns && <div className="hidden @3xl:block">{summaryPanel}</div>}
          </div>

          <div className="flex min-w-0 flex-col gap-6">
            {errorFields.length > 0 && (
              <div ref={summaryRef} tabIndex={-1} role="group" aria-labelledby={id('summary')} data-testid="order-form-error-summary" className="rounded-lg border-2 border-sf-sale bg-sf-surface p-4 text-sf-heading focus:outline-2 focus:outline-offset-2 focus:outline-sf-sale">
                <p id={id('summary')} className="font-semibold">
                  {t('landing.orderForm.errorSummary')}
                </p>
                <ul className="mt-2 list-disc ps-5">
                  {errorFields.map((field) => (
                    <li key={field}>
                      <a
                        href={`#${id(field)}`}
                        className="underline underline-offset-2"
                        onClick={(e) => {
                          e.preventDefault()
                          focusField(field)
                        }}
                      >
                        {t(FIELD_LABELS[field])}: {errorText(field)}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <section aria-labelledby={id('details')} className={SECTION}>
              <h3 id={id('details')} className={HEADING}>
                {t('landing.orderForm.details')}
              </h3>
              <div className="grid gap-4 @lg:grid-cols-2">
                {textField('name', t('landing.orderForm.name'), { autoComplete: 'name', maxLength: 120, required: true })}
                {textField('phone', t('landing.orderForm.phone'), { type: 'tel', autoComplete: 'tel', inputMode: 'tel', placeholder: t('checkout.phonePlaceholder'), maxLength: 20, hint: t('landing.orderForm.phoneHint'), required: true })}
                {rules.email !== 'hidden' && (
                  <div className="@lg:col-span-2">
                    {textField('email', rules.email === 'required' ? t('landing.orderForm.email') : t('landing.orderForm.emailOptional'), { type: 'email', autoComplete: 'email', inputMode: 'email', maxLength: 255, required: rules.email === 'required' })}
                  </div>
                )}
              </div>
            </section>

            <section aria-labelledby={id('address')} className={SECTION}>
              <h3 id={id('address')} className={HEADING}>
                {t('landing.orderForm.address')}
              </h3>
              {divisions.isError && <p className="text-sm font-medium text-sf-sale">{t('checkout.address.divisionsFailed')}</p>}
              <div className="grid gap-4 @lg:grid-cols-2">
                {geoSelect('division_id', t('checkout.address.division'), divisions.data, divisions.isPending && !canvas ? t('checkout.address.loading') : t('checkout.address.chooseDivision'), !divisions.data)}
                {geoSelect(
                  'district_id',
                  t('checkout.address.district'),
                  values.division_id ? districts.data : [],
                  values.division_id ? (districts.isPending ? t('checkout.address.loading') : t('checkout.address.chooseDistrict')) : t('checkout.address.chooseDivisionFirst'),
                  !values.division_id || !districts.data,
                )}
                <div className="@lg:col-span-2">{textField('area', t('landing.orderForm.area'), { maxLength: 100 })}</div>
                <div className="@lg:col-span-2">
                  {textField('address_line', t('landing.orderForm.addressLine'), { autoComplete: 'street-address', maxLength: 255, placeholder: t('landing.orderForm.addressLinePlaceholder'), required: true })}
                </div>
              </div>
            </section>

            <DeliveryChoice
              groupId={id('shipping_method_id')}
              errorId={id('shipping_method_id', '-error')}
              error={errorText('shipping_method_id')}
              methods={methods}
              value={values.shipping_method_id}
              onChange={(value) => set('shipping_method_id', value)}
              pending={deliveryPending}
              loading={updating && methods.length === 0}
              notServed={!deliveryPending && ((preview.error instanceof ApiError && preview.error.code === 'SHIPPING_UNAVAILABLE') || (!updating && current !== null && methods.length === 0))}
              currency={currency}
              freeShipping={(shown?.promotions ?? []).some((promotion) => promotion.kind === 'shipping')}
            />

            <PaymentChoice
              groupId={id('payment_method')}
              errorId={id('payment_method', '-error')}
              error={errorText('payment_method')}
              methods={paymentMethods}
              value={values.payment_method}
              onChange={(value) => set('payment_method', value)}
              selectedMethod={selectedMethod}
              currency={currency}
            />

            {rules.note !== 'hidden' && (
              <div className="flex flex-col gap-1.5">
                <label htmlFor={id('note')} className="text-sm font-semibold text-sf-heading">
                  {t('landing.orderForm.note')}
                </label>
                <textarea
                  id={id('note')}
                  rows={2}
                  maxLength={500}
                  value={values.note}
                  onChange={(e) => set('note', e.target.value)}
                  placeholder={t('landing.orderForm.notePlaceholder')}
                  aria-invalid={errors.note ? true : undefined}
                  aria-describedby={describedBy('note')}
                  className={cn(INPUT, 'resize-y')}
                />
                {fieldError('note')}
              </div>
            )}

            <div className={cn(twoColumns && '@3xl:hidden')}>{summaryPanel}</div>

            <div className="flex flex-col gap-3">
              {problem && (
                <div ref={problemRef} tabIndex={-1} role="alert" className="flex flex-col gap-1 rounded-lg bg-sf-sale/10 px-4 py-3 text-sm font-medium text-sf-sale focus:outline-2 focus:outline-sf-sale" data-testid="order-form-problem" data-code={problem.code}>
                  <span>{problem.message}</span>
                  {problem.link && (
                    <Link to={problem.link.to} className="font-bold underline underline-offset-4 hover:no-underline">
                      {problem.link.label}
                    </Link>
                  )}
                </div>
              )}
              {unavailable && !inactive && (
                <p role="status" className="flex items-start gap-2 rounded-lg bg-sf-sale/10 px-4 py-3 text-sm font-medium text-sf-sale" data-testid="order-form-unavailable">
                  <CircleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
                  {t('landing.orderForm.unavailable')}
                </p>
              )}
              {needsSignIn && !inactive && !unavailable && (
                <p className="text-sm">
                  {t('landing.orderForm.signInRequired')}{' '}
                  <Link to={loginPathFor(pathname)} className="font-semibold text-sf-link underline underline-offset-4">
                    {t('checkout.problem.signIn')}
                  </Link>
                </p>
              )}
              {inactive && (
                <p role="note" className="rounded-lg bg-sf-canvas p-3 text-sm" data-testid="order-form-draft-note">
                  {t('landing.orderForm.draft')}
                </p>
              )}
              {/* Two columns: the summary is beside the form, so the total is repeated by the button. */}
              {twoColumns && shown && !inactive && (
                <p className="hidden items-baseline justify-between gap-4 text-base @3xl:flex">
                  <span className="font-bold text-sf-heading">{t('checkout.summary.total')}</span>
                  <span className="font-heading text-xl font-extrabold text-sf-heading" data-testid="order-form-total">
                    {formatPrice(shown.total, currency)}
                  </span>
                </p>
              )}
              <button type="submit" disabled={inactive || unavailable || busy} aria-disabled={inactive || undefined} className={CONFIRM} data-testid="order-form-submit">
                {busy ? <Loader2Icon aria-hidden className="size-5 animate-spin" /> : <PackageCheckIcon aria-hidden className="size-5" />}
                {busy ? t('landing.orderForm.placing') : confirming ? t('landing.orderForm.confirmNewTotal') : buttonLabel}
              </button>
              {codOnly && <p className="text-center text-sm">{t('landing.orderForm.payOnDelivery')}</p>}
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}

function RequiredMark() {
  const { t } = useLocale()
  return (
    <>
      <span aria-hidden="true" className="ms-0.5 text-sf-sale">
        *
      </span>
      <span className="sr-only"> ({t('content.builder.form.required')})</span>
    </>
  )
}

function DeliveryChoice({
  groupId,
  errorId,
  error,
  methods,
  value,
  onChange,
  pending,
  loading,
  notServed,
  currency,
  freeShipping,
}: {
  groupId: string
  errorId: string
  error: string | undefined
  methods: ShippingMethod[]
  value: string
  onChange: (value: string) => void
  pending: boolean
  loading: boolean
  notServed: boolean
  currency: string | null
  freeShipping: boolean
}) {
  const { t } = useLocale()
  let body: ReactNode
  if (pending) body = <p className="text-sm">{t('landing.orderForm.deliveryChooseDistrict')}</p>
  else if (notServed) {
    body = (
      <p className="flex items-start gap-2 text-sm font-medium text-sf-sale" data-testid="order-form-not-served">
        <CircleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
        {t('checkout.delivery.notDelivered')}
      </p>
    )
  } else if (loading || methods.length === 0) body = <p className="text-sm">{t('checkout.delivery.loading')}</p>
  else {
    body = (
      <div className="flex flex-col gap-2">
        {methods.map((method) => {
          const fee = freeShipping ? '0.00' : method.fee
          const eta = etaLabel(method.eta_min_days, method.eta_max_days, t)
          return (
            <label key={method.id} className={RADIO_CARD} data-testid="order-form-shipping">
              <input type="radio" name={groupId} value={method.id} checked={value === method.id} onChange={() => onChange(method.id)} aria-invalid={error ? true : undefined} className="mt-1 size-5 shrink-0 accent-sf-accent" />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <span className="font-semibold text-sf-heading">{method.name}</span>
                  <span className="font-semibold text-sf-heading">{isZeroDecimal(fee) ? t('checkout.delivery.free') : formatPrice(fee, currency)}</span>
                </span>
                {eta && <span className="block text-sm">{t('checkout.delivery.eta', { eta })}</span>}
              </span>
            </label>
          )
        })}
      </div>
    )
  }
  return (
    <fieldset id={groupId} tabIndex={-1} className="flex flex-col gap-3 focus:outline-none" aria-describedby={error ? errorId : undefined} aria-busy={loading || undefined}>
      <legend className="mb-3 flex items-center gap-2 font-heading text-lg font-bold text-sf-heading">
        <TruckIcon aria-hidden className="size-5" />
        {t('landing.orderForm.delivery')}
      </legend>
      {body}
      {error && (
        <p id={errorId} className="text-sm font-medium text-sf-sale">
          {error}
        </p>
      )}
    </fieldset>
  )
}

function PaymentChoice({
  groupId,
  errorId,
  error,
  methods,
  value,
  onChange,
  selectedMethod,
  currency,
}: {
  groupId: string
  errorId: string
  error: string | undefined
  methods: OrderFormData['payment_methods']
  value: string
  onChange: (value: string) => void
  selectedMethod: ShippingMethod | null
  currency: string | null
}) {
  const { t } = useLocale()
  if (methods.length === 0) return null
  return (
    <fieldset id={groupId} tabIndex={-1} className="flex flex-col gap-3 focus:outline-none" aria-describedby={error ? errorId : undefined}>
      <legend className="mb-3 font-heading text-lg font-bold text-sf-heading">{t('landing.orderForm.payment')}</legend>
      <div className="flex flex-col gap-2">
        {methods.map((method) => {
          const codBlocked = method.code === 'cod' && selectedMethod !== null && !selectedMethod.cod_allowed
          const codFee = method.code === 'cod' && selectedMethod && !isZeroDecimal(selectedMethod.cod_fee) ? selectedMethod.cod_fee : null
          return (
            <label key={method.code} className={cn(RADIO_CARD, codBlocked && 'cursor-not-allowed opacity-60')} data-testid="order-form-payment">
              <input
                type="radio"
                name={groupId}
                value={method.code}
                checked={value === method.code}
                disabled={codBlocked}
                onChange={() => onChange(method.code)}
                aria-invalid={error ? true : undefined}
                className="mt-1 size-5 shrink-0 accent-sf-accent"
              />
              <span className="min-w-0 flex-1">
                <span className="block font-semibold text-sf-heading">{method.code === 'cod' ? t('landing.orderForm.cod') : method.display_name}</span>
                <span className="block text-sm">{method.code === 'cod' ? t('landing.orderForm.codText') : t('checkout.payment.bankTransfer')}</span>
                {codBlocked && selectedMethod && <span className="block text-sm font-medium text-sf-sale">{t('checkout.payment.notWith', { method: selectedMethod.name })}</span>}
                {codFee && <span className="block text-xs">{t('checkout.payment.codFee', { amount: formatPrice(codFee, currency) })}</span>}
              </span>
            </label>
          )
        })}
      </div>
      {error && (
        <p id={errorId} className="text-sm font-medium text-sf-sale">
          {error}
        </p>
      )}
    </fieldset>
  )
}

/** The order summary: the lines and totals exactly as the server computed them. */
function OrderSummary({
  preview,
  error,
  updating,
  deliveryPending,
  currency,
  inactive,
  onRetry,
}: {
  preview: CheckoutPreview | null
  error: unknown
  updating: boolean
  deliveryPending: boolean
  currency: string | null
  inactive: boolean
  onRetry: () => void
}) {
  const { t, formatNumber } = useLocale()
  const headingId = useId()
  const total = preview ? formatPrice(preview.total, currency) : null
  let body: ReactNode
  if (inactive) body = <p className="text-sm">{t('landing.orderForm.summaryDraft')}</p>
  else if (preview) {
    body = (
      <>
        <ul className="flex flex-col divide-y" aria-label={t('checkout.summary.linesLabel')}>
          {(Array.isArray(preview.lines) ? preview.lines : []).map((line, index) => (
            <li key={line.id ?? `${line.variant_id}-${index}`} className="flex justify-between gap-3 py-2 text-sm" data-testid="order-form-line">
              <span className="min-w-0">
                <span className="block font-semibold text-sf-heading">{line.product?.name}</span>
                {line.variant_name && <span className="block text-xs">{line.variant_name}</span>}
                <span className="block text-xs">
                  {t('checkout.summary.qty')} {formatNumber(displayQuantity(line.quantity))} × {formatPrice(line.unit_price, currency)}
                </span>
              </span>
              <span className="shrink-0 font-semibold text-sf-heading">{formatPrice(line.line_total, currency)}</span>
            </li>
          ))}
        </ul>
        {preview.issues.length > 0 && (
          <p className="flex items-start gap-2 text-sm font-medium text-sf-sale" data-testid="order-form-issues">
            <CircleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
            {t('landing.orderForm.issues')}
          </p>
        )}
        <SummaryTotals amounts={preview} currency={currency} deliveryPending={deliveryPending} />
      </>
    )
  } else if (error) {
    body = (
      <div className="text-sm">
        <p role="alert">{t('landing.orderForm.summaryFailed')}</p>
        <button type="button" className="mt-2 min-h-11 font-semibold text-sf-accent underline underline-offset-4" onClick={onRetry}>
          {t('common.tryAgain')}
        </button>
      </div>
    )
  } else {
    body = (
      <p role="status" className="flex items-center gap-2 text-sm">
        <Loader2Icon aria-hidden className="size-4 animate-spin" />
        {t('landing.orderForm.summaryLoading')}
      </p>
    )
  }
  return (
    <section aria-labelledby={headingId} className={cn('flex flex-col gap-3 rounded-sf-card border border-sf-border bg-sf-surface p-4', updating && preview && 'opacity-70 transition-opacity')} aria-busy={updating || undefined} data-testid="order-form-summary">
      <h3 id={headingId} className={HEADING}>
        {t('landing.orderForm.summary')}
      </h3>
      {/* Announces the new total after every recomputation. */}
      <p className="sr-only" aria-live="polite">
        {total && !inactive ? t('checkout.summary.announcement', { total }) : ''}
      </p>
      {body}
    </section>
  )
}

/** After placing: the order number, the store's message and the order page link. Takes the focus. */
function ThankYou({ placed, name, message }: { placed: DirectPlacedOrder; name: string; message: string }) {
  const { t } = useLocale()
  const ref = useRef<HTMLDivElement>(null)
  const link = useMemo(() => orderLink(placed), [placed])
  useEffect(() => {
    ref.current?.focus()
    ref.current?.scrollIntoView?.({ block: 'center' })
  }, [])
  const order = placed.order
  return (
    <div ref={ref} tabIndex={-1} role="status" className="flex flex-col items-center gap-3 rounded-sf-card border-2 border-sf-accent bg-sf-surface p-6 text-center focus:outline-none" data-testid="order-form-thanks">
      <CircleCheckIcon aria-hidden className="size-14 text-sf-accent" />
      <h2 className="font-heading text-2xl font-extrabold text-sf-heading">{t('landing.orderForm.thanks.title', { name })}</h2>
      <p className="text-base">
        {t('landing.orderForm.thanks.number')} <strong className="font-bold tracking-wide text-sf-heading" data-testid="order-form-number">{order.number}</strong>
      </p>
      {order.total && <p className="text-base">{t('landing.orderForm.thanks.total', { total: formatPrice(order.total, order.currency) })}</p>}
      {message && <p className="max-w-prose whitespace-pre-line">{message}</p>}
      <Link to={link} state={{ placed: true }} className="sf-button mt-2 inline-flex min-h-12 items-center justify-center rounded-sf-button bg-sf-button px-6 py-3 font-bold text-sf-button-foreground">
        {t('landing.orderForm.thanks.view')}
      </Link>
    </div>
  )
}
