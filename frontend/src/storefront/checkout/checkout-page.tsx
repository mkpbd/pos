import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router'
import { useForm, useWatch, type UseFormReturn } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { ChevronDownIcon, CircleAlertIcon, Loader2Icon, LockIcon, ShoppingBagIcon, TruckIcon } from 'lucide-react'
import { ApiError } from '@/lib/api/client'
import { isZeroDecimal } from '@/lib/money'
import { cn } from '@/lib/utils'
import { MAX_ADDRESSES, useAddressesQuery, useDistrictsQuery, useDivisionsQuery, useMeQuery } from '../account/api'
import { FormAlert, Spinner, TextField, inputClass, primaryButtonClass, secondaryButtonClass } from '../account/form-controls'
import { loginPathFor } from '../account/safe-next'
import { useCartQuery } from '../cart/api'
import { cartNeedsAttention } from '../cart/cart-helpers'
import { couponNote } from '../cart/coupon-messages'
import { formatPrice } from '../money'
import type { MessageKey } from '../i18n/en'
import { useLocale } from '../i18n/locale'
import { checkoutKeys, customerKeys, localized, setLocalizedData } from '../store-keys'
import type { Cart, CartCoupon, CheckoutOptions, CheckoutPreview, Customer, CustomerAddress, GeoId, ShippingMethod } from '../types'
import { privatePage, useDocumentMeta } from '../use-document-meta'
import { useCheckoutOptionsQuery, useCheckoutPreviewQuery, usePlaceOrderMutation } from './api'
import { etaLabel, goodsTotal, methodFee } from './delivery'
import { PlacementAttempts } from './placement-attempt'
import { changedPreview, placementProblem, type PlacementProblem } from './placement-errors'
import { checkoutSchema, formFieldFor, initialCheckoutValues, NEW_ADDRESS, toPlaceInput, toPreviewInput, type CheckoutValues, type GeoIdLookup } from './schema'
import { SummaryLines, SummaryTotals } from './summary-totals'
import { useDebouncedValue } from './use-debounced-value'
import { readAttribution } from '../landing/attribution'

/** How long the form must be still before the summary is recomputed. */
export const PREVIEW_DEBOUNCE_MS = 250

const REGISTER_PATH = `/account/register?next=${encodeURIComponent('/checkout')}`

/**
 * /checkout: one page with contact, delivery address, delivery method, payment method and
 * notes, next to a summary the server recomputes (POST /store/checkout/preview) whenever a
 * choice that affects the price changes. Guests check out without an account unless the
 * store requires one.
 */
/** A field error to show: a client-side message key translated, a server message as it is. */
function useErrorText() {
  const { translateMessage, digits } = useLocale()
  return (message: string | undefined) => (message ? digits(translateMessage(message)) : undefined)
}

export function CheckoutPage() {
  const { t } = useLocale()
  useDocumentMeta(privatePage(t('checkout.page.title')))
  const me = useMeQuery()
  const options = useCheckoutOptionsQuery()
  const cart = useCartQuery()
  const customer = me.data ?? null
  const addresses = useAddressesQuery(customer !== null)

  if (me.isPending || options.isPending || (!cart.data && cart.isPending)) return <Spinner label={t('checkout.page.loading')} />
  if (options.error || !options.data || (cart.error && !cart.data)) {
    return (
      <CheckoutMessage title={t('checkout.page.loadFailedTitle')}>
        <p>{t('checkout.page.loadFailedText')}</p>
        <button
          type="button"
          className={`${primaryButtonClass} mt-4`}
          disabled={options.isFetching || cart.isFetching}
          onClick={() => {
            void options.refetch()
            void cart.refetch()
          }}
        >
          {t('common.tryAgain')}
        </button>
      </CheckoutMessage>
    )
  }
  if (cart.data?.items.length === 0 || options.data.reason === 'cart_empty') {
    return (
      <CheckoutMessage title={t('checkout.page.emptyTitle')} icon>
        <p>{t('checkout.page.emptyText')}</p>
        <Link to="/shop" className={`${primaryButtonClass} mt-4`}>
          {t('checkout.page.startShopping')}
        </Link>
      </CheckoutMessage>
    )
  }
  if (!options.data.available) {
    return (
      <CheckoutMessage title={t('checkout.page.unavailableTitle')}>
        <p>{t('checkout.page.unavailableText')}</p>
        <Link to="/cart" className={`${secondaryButtonClass} mt-4`}>
          {t('checkout.page.backToCart')}
        </Link>
      </CheckoutMessage>
    )
  }
  if (!customer && !options.data.guest_checkout) {
    return (
      <CheckoutMessage title={t('checkout.page.signInTitle')}>
        <p>{t('checkout.page.signInText')}</p>
        <div className="mt-4 flex flex-wrap justify-center gap-3">
          <Link to={loginPathFor('/checkout')} className={primaryButtonClass}>
            {t('checkout.page.signIn')}
          </Link>
          <Link to={REGISTER_PATH} className={secondaryButtonClass}>
            {t('checkout.page.createAccount')}
          </Link>
        </div>
      </CheckoutMessage>
    )
  }
  if (customer && addresses.isPending) return <Spinner label={t('checkout.page.loadingAddresses')} />

  return <CheckoutForm key={customer?.id ?? 'guest'} customer={customer} addresses={customer ? (addresses.data ?? []) : []} options={options.data} cart={cart.data} />
}

function CheckoutMessage({ title, icon = false, children }: { title: string; icon?: boolean; children: ReactNode }) {
  const { t } = useLocale()
  return (
    <section className="mx-auto max-w-sf px-4 py-8 lg:py-12" data-testid="checkout-page">
      <h1 className="text-3xl font-extrabold lg:text-4xl">{t('checkout.page.title')}</h1>
      <div className="mt-6 flex flex-col items-center rounded-sf-card bg-sf-surface p-8 text-center sm:p-10">
        {icon && <ShoppingBagIcon aria-hidden className="mb-4 size-14 text-sf-border" />}
        <h2 className="text-xl font-bold">{title}</h2>
        <div className="mt-2 flex flex-col items-center">{children}</div>
      </div>
    </section>
  )
}

type Form = UseFormReturn<CheckoutValues>

function CheckoutForm({ customer, addresses, options, cart }: { customer: Customer | null; addresses: CustomerAddress[]; options: CheckoutOptions; cart: Cart | undefined }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { locale, t } = useLocale()
  const place = usePlaceOrderMutation()
  const [attempts] = useState(() => new PlacementAttempts())
  const [problem, setProblem] = useState<PlacementProblem | null>(null)
  const [focusRequest, setFocusRequest] = useState<{ alertFirst: boolean } | null>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const alertRef = useRef<HTMLDivElement>(null)

  const form = useForm<CheckoutValues>({
    resolver: zodResolver(checkoutSchema),
    defaultValues: initialCheckoutValues(customer, addresses),
    shouldFocusError: false,
  })
  const { control } = form
  const addressChoice = useWatch({ control, name: 'address_choice' })
  const divisionId = useWatch({ control, name: 'division_id' })
  const districtId = useWatch({ control, name: 'district_id' })
  const shippingMethodId = useWatch({ control, name: 'shipping_method_id' })
  const paymentMethod = useWatch({ control, name: 'payment_method' })
  const contactName = useWatch({ control, name: 'name' })
  const contactPhone = useWatch({ control, name: 'phone' })

  const divisions = useDivisionsQuery()
  const districts = useDistrictsQuery(divisionId)
  const geoId: GeoIdLookup = (kind, value) => {
    const list: { id: GeoId }[] | undefined = kind === 'division' ? divisions.data : districts.data
    return list?.find((item) => String(item.id) === value)?.id ?? value
  }

  const previewInput = toPreviewInput({ address_choice: addressChoice, division_id: divisionId, district_id: districtId, shipping_method_id: shippingMethodId, payment_method: paymentMethod }, geoId)
  const [settledInput, debouncing] = useDebouncedValue(previewInput, PREVIEW_DEBOUNCE_MS)
  const preview = useCheckoutPreviewQuery(settledInput, true)
  const current = preview.isPlaceholderData ? null : (preview.data ?? null)
  const shown = preview.data ?? null
  const updating = debouncing || preview.isFetching
  const deliveryPending = !settledInput.shipping_address_id && !settledInput.address
  const needsAttention = (cart ? cartNeedsAttention(cart) : false) || (current?.issues.length ?? 0) > 0
  const methods = shown?.shipping_methods ?? []
  const selectedMethod = methods.find((m) => m.id === shippingMethodId) ?? null

  // Take the server's delivery choice when ours is not offered for this address.
  useEffect(() => {
    if (!current) return
    const offered = current.shipping_methods
    if (offered.some((m) => m.id === shippingMethodId)) return
    const next = current.shipping_method_id && offered.some((m) => m.id === current.shipping_method_id) ? current.shipping_method_id : offered.length === 1 ? offered[0]!.id : ''
    if (next !== shippingMethodId) form.setValue('shipping_method_id', next)
  }, [current, shippingMethodId, form])

  // Cash on delivery is not offered by every delivery method.
  useEffect(() => {
    if (paymentMethod === 'cod' && selectedMethod && !selectedMethod.cod_allowed) form.setValue('payment_method', '')
  }, [paymentMethod, selectedMethod, form])

  // The recipient is the contact person until the shopper types another one.
  useEffect(() => {
    if (!form.getFieldState('recipient_name').isDirty) form.setValue('recipient_name', contactName)
    if (!form.getFieldState('address_phone').isDirty) form.setValue('address_phone', contactPhone)
  }, [contactName, contactPhone, form])

  // After a failed attempt: the first field with an error (or the message) gets the focus.
  useEffect(() => {
    if (!focusRequest) return
    const firstInvalid = formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')
    ;(focusRequest.alertFirst ? (alertRef.current ?? firstInvalid) : (firstInvalid ?? alertRef.current))?.focus()
  }, [focusRequest])

  const onSubmit = form.handleSubmit(
    (values) => {
      if (!current) return
      setProblem(null)
      const signedIn = customer !== null
      const input = toPlaceInput(values, current.total, { signedIn, geoId })
      // P2a: the campaign that brought the shopper (last touch of the past 30 days).
      const attribution = readAttribution()
      if (attribution) input.attribution = attribution
      const idempotencyKey = attempts.keyFor(input)
      place.mutate(
        { input, idempotencyKey },
        {
          onSuccess: (placed) => {
            attempts.reset()
            navigate(`/order/${encodeURIComponent(placed.order.number)}`, { replace: true, state: { placed: true } })
          },
          onError: (error) => {
            attempts.settle(error)
            const result = handlePlacementError(error, input.expected_total)
            setProblem(result)
            setFocusRequest({ alertFirst: !result.field && result.code !== 'VALIDATION_FAILED' })
          },
        },
      )
    },
    () => {
      setProblem(null)
      setFocusRequest({ alertFirst: false })
    },
  )

  /** Applies what a failed placement tells us (fresh totals, fresh cart, field errors) and returns the message. */
  function handlePlacementError(error: unknown, expectedTotal: string): PlacementProblem {
    const result = placementProblem(error, t)
    if (!(error instanceof ApiError)) return result
    switch (error.code) {
      case 'TOTAL_CHANGED': {
        const fresh = changedPreview(error)
        if (fresh) {
          queryClient.setQueryData<CheckoutPreview>(localized(checkoutKeys.preview(settledInput), locale), fresh)
          const currency = fresh.currency ?? cart?.currency ?? null
          return {
            ...result,
            message: t('checkout.problem.totalChangedFrom', { from: formatPrice(expectedTotal, currency), to: formatPrice(fresh.total, currency) }),
          }
        }
        void queryClient.invalidateQueries({ queryKey: checkoutKeys.previewAll })
        return result
      }
      case 'CART_HAS_ISSUES': {
        const fresh = error.details.cart
        if (fresh && typeof fresh === 'object' && 'items' in fresh) setLocalizedData(queryClient, customerKeys.cart, locale, fresh)
        else void queryClient.invalidateQueries({ queryKey: customerKeys.cart })
        void queryClient.invalidateQueries({ queryKey: checkoutKeys.previewAll })
        return result
      }
      case 'INSUFFICIENT_STOCK':
      case 'CART_EMPTY':
        void queryClient.invalidateQueries({ queryKey: customerKeys.cart })
        void queryClient.invalidateQueries({ queryKey: checkoutKeys.previewAll })
        return result
      case 'SHIPPING_UNAVAILABLE':
      case 'PAYMENT_METHOD_UNAVAILABLE':
        if (result.field) form.setError(result.field, { type: 'server', message: result.message })
        void queryClient.invalidateQueries({ queryKey: checkoutKeys.previewAll })
        return result
      case 'CHECKOUT_UNAVAILABLE':
      case 'GUEST_CHECKOUT_DISABLED':
        void queryClient.invalidateQueries({ queryKey: checkoutKeys.options })
        return result
      case 'VALIDATION_FAILED': {
        let mapped = false
        for (const [key, messages] of Object.entries(error.fieldErrors)) {
          const field = formFieldFor(key)
          if (field && messages[0]) {
            form.setError(field, { type: 'server', message: messages[0] })
            mapped = true
          }
        }
        return mapped ? result : { ...result, message: Object.values(error.fieldErrors)[0]?.[0] ?? result.message }
      }
    }
    return result
  }

  const placeId = useId()
  const blocked = place.isPending || !current || updating || needsAttention
  const blockedReason = place.isPending ? null : needsAttention ? t('checkout.page.blockedFix') : updating || !current ? t('checkout.page.updatingTotal') : null
  const confirming = problem?.code === 'TOTAL_CHANGED'

  return (
    <section className="mx-auto max-w-sf px-4 py-8 lg:py-12" data-testid="checkout-page">
      <h1 className="text-3xl font-extrabold lg:text-4xl">{t('checkout.page.title')}</h1>
      {!customer && (
        <p className="mt-2 text-sm">
          {t('checkout.page.haveAccount')}{' '}
          <Link to={loginPathFor('/checkout')} className="font-semibold text-sf-link underline underline-offset-4 hover:no-underline">
            {t('checkout.page.signInFaster')}
          </Link>
        </p>
      )}
      {needsAttention && (
        <p role="status" className="mt-4 flex flex-wrap items-start gap-2 rounded-sf-card bg-sf-sale/10 px-4 py-3 text-sm font-medium text-sf-sale" data-testid="checkout-cart-issues">
          <CircleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
          <span className="flex-1">{t('checkout.page.cartIssues')}</span>
          <Link to="/cart" className="font-bold underline underline-offset-4 hover:no-underline">
            {t('checkout.page.reviewCart')}
          </Link>
        </p>
      )}

      <div className="mt-6 grid items-start gap-6 lg:grid-cols-[1fr_24rem]">
        <OrderSummaryPanel
          preview={shown}
          error={preview.error}
          updating={updating}
          deliveryPending={deliveryPending}
          currency={shown?.currency ?? cart?.currency ?? null}
          coupon={cart?.coupon ?? null}
          onRetry={() => void preview.refetch()}
        />

        <form ref={formRef} noValidate onSubmit={onSubmit} aria-label={t('checkout.page.formLabel')} className="flex min-w-0 flex-col gap-6 lg:order-first">
          <ContactSection form={form} />
          <AddressSection form={form} customer={customer} addresses={addresses} divisions={divisions} districts={districts} />
          <DeliverySection
            form={form}
            methods={methods}
            preview={shown}
            deliveryPending={deliveryPending}
            loading={updating && methods.length === 0}
            error={preview.error}
            currency={shown?.currency ?? null}
            freeShipping={Boolean(cart?.free_shipping) || (shown?.promotions ?? []).some((p) => p.kind === 'shipping')}
          />
          <PaymentSection form={form} options={options} selectedMethod={selectedMethod} currency={shown?.currency ?? null} />
          <NotesSection form={form} />

          <div className="flex flex-col gap-3 rounded-sf-card bg-sf-surface p-5 md:p-6">
            {problem && (
              <div ref={alertRef} tabIndex={-1} role="alert" className="flex flex-col gap-1 rounded-lg bg-sf-sale/10 px-4 py-3 text-sm font-medium text-sf-sale focus:outline-2 focus:outline-sf-sale" data-testid="checkout-problem" data-code={problem.code}>
                <span>{problem.message}</span>
                {problem.link && (
                  <Link to={problem.link.to} className="font-bold underline underline-offset-4 hover:no-underline">
                    {problem.link.label}
                  </Link>
                )}
              </div>
            )}
            {shown && (
              <p className="flex justify-between gap-4 text-base lg:hidden">
                <span className="font-bold text-sf-heading">{t('checkout.page.total')}</span>
                <span className="font-heading text-xl font-extrabold text-sf-heading">{formatPrice(shown.total, shown.currency)}</span>
              </p>
            )}
            <button type="submit" disabled={blocked} aria-describedby={blockedReason ? `${placeId}-reason` : undefined} className={cn(primaryButtonClass, 'w-full')}>
              {place.isPending ? <Loader2Icon aria-hidden className="size-4 animate-spin" /> : <LockIcon aria-hidden className="size-4" />}
              {place.isPending ? t('checkout.page.placing') : confirming ? t('checkout.page.confirmNewTotal') : t('checkout.page.placeOrder')}
            </button>
            {blockedReason && (
              <p id={`${placeId}-reason`} className={cn('text-center text-sm', needsAttention && 'text-sf-sale')}>
                {blockedReason}
              </p>
            )}
          </div>
        </form>
      </div>
    </section>
  )
}

/* Sections ------------------------------------------------------------------------------- */

const sectionClass = 'flex flex-col gap-4 rounded-sf-card bg-sf-surface p-5 md:p-6'
const headingClass = 'font-heading text-xl font-bold text-sf-heading'

function ContactSection({ form }: { form: Form }) {
  const { errors } = form.formState
  const { t } = useLocale()
  const errorText = useErrorText()
  return (
    <section aria-labelledby="checkout-contact" className={sectionClass}>
      <h2 id="checkout-contact" className={headingClass}>
        {t('checkout.contact.heading')}
      </h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label={t('checkout.contact.fullName')} autoComplete="name" maxLength={120} error={errorText(errors.name?.message)} className="sm:col-span-2" {...form.register('name')} />
        <TextField
          label={t('checkout.contact.email')}
          type="email"
          autoComplete="email"
          maxLength={255}
          error={errorText(errors.email?.message)}
          hint={t('checkout.contact.emailHint')}
          {...form.register('email')}
        />
        <TextField label={t('checkout.contact.mobile')} type="tel" autoComplete="tel" placeholder={t('checkout.phonePlaceholder')} maxLength={20} error={errorText(errors.phone?.message)} {...form.register('phone')} />
      </div>
    </section>
  )
}

type GeoQuery = { data?: { id: GeoId; name: string; name_bn: string | null }[]; isPending: boolean; isError: boolean }

function AddressSection({ form, customer, addresses, divisions, districts }: { form: Form; customer: Customer | null; addresses: CustomerAddress[]; divisions: GeoQuery; districts: GeoQuery }) {
  const choice = useWatch({ control: form.control, name: 'address_choice' })
  const errors = form.formState.errors
  const errorId = useId()
  const { t } = useLocale()
  const errorText = useErrorText()
  const showBook = customer !== null && addresses.length > 0

  if (!showBook) {
    return (
      <section aria-labelledby="checkout-address" className={sectionClass}>
        <h2 id="checkout-address" className={headingClass}>
          {t('checkout.address.heading')}
        </h2>
        <NewAddressFields form={form} divisions={divisions} districts={districts} canSave={customer !== null} bookFull={false} />
      </section>
    )
  }

  const invalid = errors.address_choice ? true : undefined
  return (
    <fieldset className={sectionClass} aria-describedby={errors.address_choice ? errorId : undefined}>
      <legend className="float-left w-full">
        <h2 className={headingClass}>{t('checkout.address.heading')}</h2>
      </legend>
      <div className="flex flex-col gap-3">
        {addresses.map((address) => (
          <RadioCard key={address.id} value={address.id} registered={form.register('address_choice')} invalid={invalid} testId="address-option">
            <span className="flex flex-wrap items-center gap-2 font-semibold text-sf-heading">
              {address.label || address.recipient_name}
              {address.is_default_shipping && <span className="rounded-full bg-sf-accent px-2 py-0.5 text-xs font-bold text-sf-accent-foreground">{t('checkout.address.default')}</span>}
            </span>
            <span className="block text-sm">
              {address.recipient_name}, {address.address_line}, {address.area}, {address.district.name}
              {address.postcode ? ` ${address.postcode}` : ''} · {address.phone}
            </span>
          </RadioCard>
        ))}
        <RadioCard value={NEW_ADDRESS} registered={form.register('address_choice')} invalid={invalid} testId="address-option">
          <span className="font-semibold text-sf-heading">{t('checkout.address.useNew')}</span>
        </RadioCard>
      </div>
      {errors.address_choice && (
        <p id={errorId} className="text-sm text-sf-sale">
          {errorText(errors.address_choice.message)}
        </p>
      )}
      {choice === NEW_ADDRESS && <NewAddressFields form={form} divisions={divisions} districts={districts} canSave bookFull={addresses.length >= MAX_ADDRESSES} />}
    </fieldset>
  )
}

const selectClass = cn(inputClass, 'appearance-auto')

function NewAddressFields({ form, divisions, districts, canSave, bookFull }: { form: Form; divisions: GeoQuery; districts: GeoQuery; canSave: boolean; bookFull: boolean }) {
  const { errors } = form.formState
  const { t } = useLocale()
  const errorText = useErrorText()
  const divisionId = useWatch({ control: form.control, name: 'division_id' })
  const districtId = useWatch({ control: form.control, name: 'district_id' })
  const divisionField = form.register('division_id', { onChange: () => form.setValue('district_id', '') })

  const select = (name: 'division_id' | 'district_id', label: string, value: string, options: GeoQuery['data'], placeholder: string, registered: ReturnType<Form['register']>, disabled: boolean) => (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={`checkout-${name}`} className="text-sm font-medium text-sf-heading">
        {label}
      </label>
      <select
        id={`checkout-${name}`}
        className={selectClass}
        disabled={disabled}
        aria-invalid={errors[name] ? true : undefined}
        aria-describedby={errors[name] ? `checkout-${name}-error` : undefined}
        {...registered}
        value={value}
      >
        <option value="">{placeholder}</option>
        {options?.map((option) => (
          <option key={String(option.id)} value={String(option.id)}>
            {option.name}
            {/* In Bangla the API's name already is the Bangla one. */}
            {option.name_bn && option.name_bn !== option.name ? ` (${option.name_bn})` : ''}
          </option>
        ))}
      </select>
      {errors[name] && (
        <p id={`checkout-${name}-error`} className="text-sm text-sf-sale">
          {errorText(errors[name]?.message)}
        </p>
      )}
    </div>
  )

  return (
    <div className="flex flex-col gap-4" data-testid="new-address">
      {divisions.isError && <FormAlert message={t('checkout.address.divisionsFailed')} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label={t('checkout.address.recipientName')} autoComplete="shipping name" maxLength={120} error={errorText(errors.recipient_name?.message)} {...form.register('recipient_name')} />
        <TextField
          label={t('checkout.address.recipientMobile')}
          type="tel"
          autoComplete="shipping tel"
          placeholder={t('checkout.phonePlaceholder')}
          maxLength={20}
          error={errorText(errors.address_phone?.message)}
          {...form.register('address_phone')}
        />
        {select(
          'division_id',
          t('checkout.address.division'),
          divisionId,
          divisions.data,
          divisions.isPending ? t('checkout.address.loading') : t('checkout.address.chooseDivision'),
          divisionField,
          !divisions.data,
        )}
        {select(
          'district_id',
          t('checkout.address.district'),
          districtId,
          divisionId ? districts.data : [],
          divisionId ? (districts.isPending ? t('checkout.address.loading') : t('checkout.address.chooseDistrict')) : t('checkout.address.chooseDivisionFirst'),
          form.register('district_id'),
          !divisionId || !districts.data,
        )}
        <TextField label={t('checkout.address.area')} maxLength={100} error={errorText(errors.area?.message)} {...form.register('area')} />
        <TextField
          label={t('checkout.address.postcode')}
          inputMode="numeric"
          autoComplete="shipping postal-code"
          maxLength={4}
          error={errorText(errors.postcode?.message)}
          {...form.register('postcode')}
        />
        <TextField
          label={t('checkout.address.street')}
          autoComplete="shipping street-address"
          maxLength={255}
          placeholder={t('checkout.address.streetPlaceholder')}
          error={errorText(errors.address_line?.message)}
          className="sm:col-span-2"
          {...form.register('address_line')}
        />
      </div>
      {canSave &&
        (bookFull ? (
          <p className="text-sm">{t('checkout.address.bookFull', { max: MAX_ADDRESSES })}</p>
        ) : (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-4 accent-sf-accent" {...form.register('save_address')} />
            {t('checkout.address.save')}
          </label>
        ))}
    </div>
  )
}

function DeliverySection({
  form,
  methods,
  preview,
  deliveryPending,
  loading,
  error,
  currency,
  freeShipping,
}: {
  form: Form
  methods: ShippingMethod[]
  preview: CheckoutPreview | null
  deliveryPending: boolean
  loading: boolean
  error: unknown
  currency: string | null
  /** A free-shipping promotion waives the delivery fee whichever method is chosen. */
  freeShipping: boolean
}) {
  const errors = form.formState.errors
  const errorId = useId()
  const { t } = useLocale()
  const errorText = useErrorText()
  const price = (amount: string) => formatPrice(amount, currency)
  const goods = preview ? goodsTotal(preview) : '0'
  const unavailable = error instanceof ApiError && error.code === 'SHIPPING_UNAVAILABLE'
  const invalid = errors.shipping_method_id ? true : undefined

  let body: ReactNode
  if (deliveryPending) body = <p className="text-sm">{t('checkout.delivery.chooseAddress')}</p>
  else if (unavailable || (!loading && preview && methods.length === 0)) {
    body = (
      <p className="flex items-start gap-2 text-sm font-medium text-sf-sale" data-testid="shipping-unavailable">
        <CircleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
        {t('checkout.delivery.notDelivered')}
      </p>
    )
  } else if (methods.length === 0) body = <p className="text-sm">{t('checkout.delivery.loading')}</p>
  else {
    body = (
      <div className="flex flex-col gap-3">
        {methods.map((method) => {
          const fee = methodFee(method, goods, freeShipping)
          const eta = etaLabel(method.eta_min_days, method.eta_max_days, t)
          return (
            <RadioCard key={method.id} value={method.id} registered={form.register('shipping_method_id')} invalid={invalid} testId="shipping-option">
              <span className="flex flex-wrap items-baseline justify-between gap-x-3">
                <span className="font-semibold text-sf-heading">{method.name}</span>
                <span className="font-semibold text-sf-heading">{isZeroDecimal(fee) ? t('checkout.delivery.free') : price(fee)}</span>
              </span>
              {method.description && <span className="block text-sm">{method.description}</span>}
              <span className="block text-xs">
                {eta && t('checkout.delivery.eta', { eta })}
                {eta && method.free_over && !isZeroDecimal(fee) ? ' · ' : ''}
                {method.free_over && !isZeroDecimal(fee) && t('checkout.delivery.freeOver', { amount: price(method.free_over) })}
              </span>
            </RadioCard>
          )
        })}
      </div>
    )
  }

  return (
    <fieldset className={sectionClass} aria-describedby={errors.shipping_method_id ? errorId : undefined} aria-busy={loading || undefined}>
      <legend className="float-left w-full">
        <h2 className={cn(headingClass, 'flex items-center gap-2')}>
          <TruckIcon aria-hidden className="size-5" />
          {t('checkout.delivery.heading')}
        </h2>
      </legend>
      {body}
      {errors.shipping_method_id && (
        <p id={errorId} className="text-sm text-sf-sale">
          {errorText(errors.shipping_method_id.message)}
        </p>
      )}
    </fieldset>
  )
}

const PAYMENT_DESCRIPTIONS: Record<string, MessageKey> = {
  cod: 'checkout.payment.cod',
  bank_transfer: 'checkout.payment.bankTransfer',
}

function PaymentSection({ form, options, selectedMethod, currency }: { form: Form; options: CheckoutOptions; selectedMethod: ShippingMethod | null; currency: string | null }) {
  const errors = form.formState.errors
  const errorId = useId()
  const { t } = useLocale()
  const errorText = useErrorText()
  const invalid = errors.payment_method ? true : undefined

  return (
    <fieldset className={sectionClass} aria-describedby={errors.payment_method ? errorId : undefined}>
      <legend className="float-left w-full">
        <h2 className={headingClass}>{t('checkout.payment.heading')}</h2>
      </legend>
      {options.payment_methods.length === 0 ? (
        <p className="text-sm">{t('checkout.payment.none')}</p>
      ) : (
        <div className="flex flex-col gap-3">
          {options.payment_methods.map((method) => {
            const codBlocked = method.code === 'cod' && selectedMethod !== null && !selectedMethod.cod_allowed
            const codFee = method.code === 'cod' && selectedMethod && !isZeroDecimal(selectedMethod.cod_fee) ? selectedMethod.cod_fee : null
            return (
              <RadioCard key={method.code} value={method.code} registered={form.register('payment_method')} invalid={invalid} disabled={codBlocked} testId="payment-option">
                <span className="block font-semibold text-sf-heading">{method.display_name}</span>
                <span className="block text-sm">{method.code in PAYMENT_DESCRIPTIONS ? t(PAYMENT_DESCRIPTIONS[method.code]!) : ''}</span>
                {codBlocked && <span className="block text-sm font-medium text-sf-sale">{t('checkout.payment.notWith', { method: selectedMethod.name })}</span>}
                {codFee && <span className="block text-xs">{t('checkout.payment.codFee', { amount: formatPrice(codFee, currency) })}</span>}
              </RadioCard>
            )
          })}
        </div>
      )}
      {errors.payment_method && (
        <p id={errorId} className="text-sm text-sf-sale">
          {errorText(errors.payment_method.message)}
        </p>
      )}
    </fieldset>
  )
}

function NotesSection({ form }: { form: Form }) {
  const id = useId()
  const { t } = useLocale()
  const error = useErrorText()(form.formState.errors.notes?.message)
  return (
    <section aria-labelledby={`${id}-heading`} className={sectionClass}>
      <h2 id={`${id}-heading`} className={headingClass}>
        {t('checkout.notes.heading')}
      </h2>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={id} className="text-sm font-medium text-sf-heading">
          {t('checkout.notes.label')}
        </label>
        <textarea
          id={id}
          rows={3}
          maxLength={500}
          className={inputClass}
          aria-invalid={error ? true : undefined}
          aria-describedby={`${id}-message`}
          placeholder={t('checkout.notes.placeholder')}
          {...form.register('notes')}
        />
        <p id={`${id}-message`} className={cn('text-sm', error && 'text-sf-sale')}>
          {error ?? t('checkout.notes.hint', { max: 500 })}
        </p>
      </div>
    </section>
  )
}

function RadioCard({
  value,
  registered,
  invalid,
  disabled = false,
  testId,
  children,
}: {
  value: string
  registered: ReturnType<Form['register']>
  invalid: true | undefined
  disabled?: boolean
  testId?: string
  children: ReactNode
}) {
  return (
    <label
      className={cn(
        'flex cursor-pointer items-start gap-3 rounded-lg border-2 border-sf-border p-4 transition has-checked:border-sf-accent has-checked:bg-sf-accent/5 has-focus-visible:outline-2 has-focus-visible:outline-sf-accent',
        disabled && 'cursor-not-allowed opacity-60',
      )}
      data-testid={testId}
    >
      <input type="radio" value={value} disabled={disabled} aria-invalid={invalid} className="mt-1 size-4 shrink-0 accent-sf-accent" {...registered} />
      <span className="min-w-0 flex-1">{children}</span>
    </label>
  )
}

/* Summary -------------------------------------------------------------------------------- */

function OrderSummaryPanel({
  preview,
  error,
  updating,
  deliveryPending,
  currency,
  coupon,
  onRetry,
}: {
  preview: CheckoutPreview | null
  error: unknown
  updating: boolean
  deliveryPending: boolean
  currency: string | null
  /** The cart's coupon: when it is not used in these totals, the summary says why. */
  coupon: CartCoupon | null
  onRetry: () => void
}) {
  const [open, setOpen] = useState(false)
  const contentId = useId()
  const { t } = useLocale()
  const total = preview ? formatPrice(preview.total, currency) : null
  const problem = useMemo(() => (error && !preview ? placementProblem(error, t) : null), [error, preview, t])

  return (
    <aside aria-labelledby="checkout-summary-heading" className="flex flex-col gap-4 rounded-sf-card bg-sf-surface p-5 md:p-6 lg:sticky lg:top-40" data-testid="order-summary" aria-busy={updating || undefined}>
      <div className="flex items-center justify-between gap-3">
        <h2 id="checkout-summary-heading" className={headingClass}>
          {t('checkout.summary.heading')}
        </h2>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-sf-accent lg:hidden"
          aria-expanded={open}
          aria-controls={contentId}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? t('checkout.summary.hide') : t('checkout.summary.show')}
          {total && <span className="text-sf-heading">{total}</span>}
          <ChevronDownIcon aria-hidden className={cn('size-4 transition', open && 'rotate-180')} />
        </button>
      </div>
      {/* Announces the new total after every recomputation. */}
      <p className="sr-only" aria-live="polite" data-testid="summary-announcement">
        {total ? t('checkout.summary.announcement', { total }) : ''}
      </p>
      <div id={contentId} className={cn('flex-col gap-4', open ? 'flex' : 'hidden lg:flex', updating && 'opacity-70 transition-opacity')}>
        {preview ? (
          <>
            <SummaryLines lines={preview.lines} currency={currency} />
            <SummaryTotals amounts={preview} currency={currency} deliveryPending={deliveryPending} />
            {coupon && !coupon.applied && (
              <p className="flex items-start gap-2 rounded-lg bg-sf-sale/10 px-3 py-2 text-xs font-medium text-sf-sale" data-testid="summary-coupon-note">
                <CircleAlertIcon aria-hidden className="mt-px size-3.5 shrink-0" />
                <span>
                  {t('checkout.summary.couponNotApplied', { code: coupon.code, note: couponNote(coupon, t) ?? '' })}{' '}
                  <Link to="/cart" className="font-bold underline underline-offset-4 hover:no-underline">
                    {t('checkout.summary.changeInCart')}
                  </Link>
                </span>
              </p>
            )}
          </>
        ) : problem ? (
          <div className="text-sm">
            <p role="alert">{problem.code === 'RETRY' ? t('checkout.summary.loadFailed') : problem.message}</p>
            <button type="button" className={`${secondaryButtonClass} mt-3`} onClick={onRetry}>
              {t('common.tryAgain')}
            </button>
          </div>
        ) : (
          <div role="status" className="grid place-items-center py-8">
            <span className="size-8 animate-spin rounded-full border-4 border-sf-border border-t-sf-accent" aria-hidden />
            <span className="sr-only">{t('checkout.summary.loading')}</span>
          </div>
        )}
      </div>
    </aside>
  )
}
