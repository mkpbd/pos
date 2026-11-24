import { configure, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/lib/api/client'
import { fail, mockApi, ok, renderRoutes } from '@/test/utils'
import { documentOf, elementNode, payloadOf } from './builder/test-payload'
import type { BuilderPage, OrderFormData } from './builder/types'
import { checkoutSchemaFor, initialCheckoutValues } from './checkout/schema'
import { orderFormErrors, EMPTY_VALUES } from './landing/order-form-logic'
import type { TrackedOrder } from './orders/track-api'
import { claimErrors, claimProblem, cleanTransactionId, codAdvanceOf, methodNames, paymentMethodLabel, paymentStateKey, sendToKey } from './payments/manual-methods'
import { storefrontRoutes } from './routes'
import {
  bilingualBootstrap,
  bootstrapFixture,
  cartFixture,
  cartLine,
  checkoutOptionsFixture,
  customerFixture,
  orderFixture,
  previewFixture,
  productDetail,
  shippingMethodFixture,
  tEn,
} from './test-fixtures'
import type { AccountOrder, ManualPaymentOption, OrderView, PaymentDue, StorefrontBootstrap } from './types'

/*
 * BD1c §6: "Send Money" (bKash / Nagad / Rocket) on the checkout and the landing-page order form,
 * the advance delivery charge notice, and the "Pay for your order" card with the transaction ID form
 * on the order page, the account's order page and the track page.
 */

vi.setConfig({ testTimeout: 25_000 })
configure({ asyncUtilTimeout: 4_000 })

afterEach(() => {
  localStorage.clear()
  sessionStorage.clear()
})

type Body = Record<string, unknown> & { payment_method?: string; address?: { district_id?: unknown } }
const bodyOf = (init: RequestInit) => JSON.parse(String(init.body ?? 'null')) as Body
const headerOf = (init: RequestInit, name: string) => new Headers(init.headers).get(name)
const created = (data: unknown) => ({ status: 201, body: { success: true, data, meta: { request_id: 't' } } })

const BKASH: ManualPaymentOption = { code: 'bkash_manual', display_name: 'bKash (Send Money)', account_number: '01712345678', account_type: 'personal', instructions: 'Use the Send Money option, not Cash Out.' }
const NAGAD: ManualPaymentOption = { code: 'nagad_manual', display_name: 'Nagad (Send Money)', account_number: '01812345678', account_type: 'merchant', instructions: null }

const due = (patch: Partial<PaymentDue> = {}): PaymentDue => ({
  amount: '960.00',
  currency: 'BDT',
  purpose: 'full',
  expires_at: '2026-11-25T10:00:00+06:00',
  methods: [BKASH],
  claim: null,
  ...patch,
})

const sendMoneyOrder = (patch: Partial<OrderView> = {}): OrderView =>
  orderFixture({
    number: 'WEB-000321',
    status: 'pending_payment',
    status_label: 'Awaiting payment',
    payment_method: 'bkash_manual',
    payment_method_label: 'bKash (Send Money)',
    expires_at: '2026-11-25T10:00:00+06:00',
    payment_due: due(),
    ...patch,
  })

const submittedClaim = { method: 'bkash_manual', transaction_id: '9A8B7C6D5E', sender_phone: '01911223344', status: 'submitted', reject_reason: null, submitted_at: '2026-11-24T11:00:00+06:00' }

/* Pure helpers -------------------------------------------------------------------------------- */

describe('Send Money helpers', () => {
  it('cleans and checks the transaction ID and the sender number', () => {
    expect(cleanTransactionId(' 9a8b-7c6d 5e ')).toBe('9A8B7C6D5E')
    expect(cleanTransactionId('৯a৮b৭c')).toBe('9A8B7C')
    expect(claimErrors({ method: '', sender_phone: '', transaction_id: '' })).toEqual({
      method: 'payments.claim.error.methodRequired',
      sender_phone: 'payments.claim.error.senderRequired',
      transaction_id: 'payments.claim.error.trxRequired',
    })
    expect(claimErrors({ method: 'bkash_manual', sender_phone: '12345', transaction_id: 'AB12' })).toEqual({ sender_phone: 'account.validation.phoneInvalid', transaction_id: 'payments.claim.error.trxInvalid' })
    expect(claimErrors({ method: 'bkash_manual', sender_phone: '+880 1911-223344', transaction_id: '9a8b7c6d5e' })).toEqual({})
  })

  it('maps the claim errors to messages and fields', () => {
    expect(claimProblem(new ApiError(422, 'TRANSACTION_ID_USED', 'Used'), tEn)).toEqual({ message: 'This transaction ID has already been used. Please check it and try again.', field: 'transaction_id' })
    expect(claimProblem(new ApiError(409, 'PAYMENT_CLAIM_PENDING', 'Pending'), tEn)).toEqual({ message: 'We are already checking a payment for this order. Please wait for our confirmation.', refresh: true })
    expect(claimProblem(new ApiError(422, 'PAYMENT_NOT_DUE', 'Not due'), tEn)).toEqual({ message: 'This order has nothing to pay right now.', refresh: true })
    expect(claimProblem(new ApiError(404, 'ORDER_NOT_FOUND', 'Nope'), tEn).message).toBe('We could not find this order. Please reload the page and try again.')
    expect(claimProblem(new ApiError(422, 'VALIDATION_FAILED', 'Invalid', { transaction_id: ['The transaction ID format is invalid.'] }), tEn)).toEqual({
      message: 'Please check the highlighted fields.',
      fields: { transaction_id: 'The transaction ID format is invalid.' },
    })
    expect(claimProblem(new ApiError(422, 'VALIDATION_FAILED', 'Invalid', { method: ['Not allowed.'] }), tEn)).toMatchObject({ field: 'method', refresh: true })
    expect(claimProblem(new ApiError(429, 'RATE_LIMITED', 'Slow down'), tEn).message).toBe(tEn('common.form.tooManyAttempts'))
  })

  it('names the methods, account kinds and payment states', () => {
    expect(paymentMethodLabel(tEn, 'nagad_manual')).toBe('Nagad (Send Money)')
    expect(paymentMethodLabel(tEn, 'cod')).toBe('Cash on delivery')
    expect(paymentMethodLabel(tEn, 'upay')).toBe('upay')
    expect(tEn(sendToKey('agent'), { number: '017' })).toBe('Cash Out to 017 (Agent)')
    expect(tEn(sendToKey(null), { number: '017' })).toBe('Send Money to 017 (Personal)')
    expect(tEn(paymentStateKey('partially_paid', 'cod'))).toBe('Partly paid')
    expect(tEn(paymentStateKey('unpaid', 'bkash_manual'))).toBe('Awaiting payment')
    expect(methodNames([BKASH, NAGAD, { ...BKASH }])).toBe('bKash / Nagad')
    expect(codAdvanceOf({ cod_advance: { amount: '0.00', methods: [BKASH] } })).toBeNull()
    expect(codAdvanceOf({ cod_advance: { amount: '120.00', methods: [BKASH] } })).toEqual({ amount: '120.00', methods: [BKASH] })
  })

  it('accepts the Send Money methods when placing', () => {
    const values = { ...initialCheckoutValues(null, undefined), name: 'Karim', email: 'k@example.com', phone: '01811223344', recipient_name: 'Karim', address_phone: '01811223344', division_id: '3', district_id: '47', area: 'Mirpur', address_line: 'Road 3', shipping_method_id: 'sm-home' }
    expect(checkoutSchemaFor('required').safeParse({ ...values, payment_method: 'rocket_manual' }).success).toBe(true)
    expect(checkoutSchemaFor('required').safeParse({ ...values, payment_method: 'upay' }).success).toBe(false)
    expect(orderFormErrors({ ...EMPTY_VALUES, payment_method: 'bkash_manual' }, { email: 'hidden', note: 'hidden' }, null).payment_method).toBeUndefined()
  })
})

/* Checkout ------------------------------------------------------------------------------------ */

const home = shippingMethodFixture('sm-home')

function serveCheckout(options: { advance?: boolean; placed?: OrderView } = {}) {
  const places: { body: Body; key: string | null }[] = []
  mockApi({
    'GET /store/bootstrap': ok(bootstrapFixture()),
    'GET /store/account/me': ok(null),
    'GET /store/cart': ok(cartFixture([cartLine('l-1')])),
    'GET /store/wishlist': ok({ items: [] }),
    'GET /store/checkout/options': ok(
      checkoutOptionsFixture({
        payment_methods: [
          { code: 'cod', display_name: 'Cash on delivery', instructions_preview: null },
          { code: 'bkash_manual', display_name: 'bKash (Send Money)', instructions: BKASH.instructions, account_number: '01712345678', account_type: 'personal' },
          { code: 'nagad_manual', display_name: 'Nagad (Send Money)', instructions: null, account_number: null, account_type: null },
        ],
      }),
    ),
    'GET /store/geo/divisions': ok([{ id: 3, name: 'Dhaka', name_bn: null }]),
    'GET /store/geo/districts': ok([{ id: 47, division_id: 3, name: 'Dhaka', name_bn: null }]),
    'POST /store/checkout/preview': (init) => {
      const body = bodyOf(init)
      const served = body.address?.district_id !== undefined
      return ok(
        previewFixture({
          shipping_methods: served ? [home] : [],
          shipping_method_id: served ? 'sm-home' : null,
          shipping_total: served ? '60.00' : '0.00',
          total: served ? '960.00' : '900.00',
          payment_method: (body.payment_method as 'cod') ?? null,
          cod_advance: options.advance && served ? { amount: '60.00', methods: [BKASH, NAGAD] } : null,
        }),
      )
    },
    'POST /store/checkout': (init) => {
      places.push({ body: bodyOf(init), key: headerOf(init, 'Idempotency-Key') })
      return created({ order: options.placed ?? sendMoneyOrder(), access_token: 'guest-tok' })
    },
    'POST /store/visits': ok({ recorded: true }),
  })
  return places
}

async function fillCheckout(user: ReturnType<typeof userEvent.setup>) {
  await user.type(await screen.findByLabelText('Full name'), 'Karim Uddin')
  await user.type(screen.getByLabelText('E-mail'), 'karim@example.com')
  await user.type(screen.getByRole('textbox', { name: 'Mobile number' }), '01811223344')
  await user.selectOptions(screen.getByLabelText('Division'), '3')
  await waitFor(() => expect(screen.getByLabelText('District')).toBeEnabled())
  await user.selectOptions(screen.getByLabelText('District'), '47')
  await user.type(screen.getByLabelText('Area / thana'), 'Mirpur')
  await user.type(screen.getByLabelText('Street address'), 'Road 3, House 9')
}

describe('checkout with Send Money', () => {
  it('offers the Send Money methods with the shop number, places the order with one and shows the payment card', async () => {
    const places = serveCheckout()
    const { router } = renderRoutes(storefrontRoutes, '/checkout')
    const user = userEvent.setup()
    await fillCheckout(user)

    const bkash = await screen.findByRole('radio', { name: /bKash \(Send Money\)/ })
    expect(bkash.closest('label')).toHaveTextContent('Send the money to 01712345678 (Personal) after placing the order.')
    expect(screen.getByRole('radio', { name: /Nagad \(Send Money\)/ }).closest('label')).toHaveTextContent('Pay from your phone after placing the order.')
    await user.click(bkash)
    await waitFor(() => expect(screen.getByTestId('summary-total')).toHaveTextContent('৳960.00'))
    await waitFor(() => expect(screen.getByRole('button', { name: /place order/i })).toBeEnabled())
    await user.click(screen.getByRole('button', { name: /place order/i }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/order/WEB-000321'))
    expect(places).toHaveLength(1)
    expect(places[0]!.body.payment_method).toBe('bkash_manual')
    const card = await screen.findByTestId('payment-due')
    expect(within(card).getByRole('heading', { name: 'Pay for your order' })).toBeInTheDocument()
    expect(within(card).getByTestId('payment-due-amount')).toHaveTextContent('৳960.00')
    expect(within(card).getByTestId('payment-due-account')).toHaveTextContent('Send Money to 01712345678 (Personal)')
    expect(within(card).getByTestId('payment-due-account')).toHaveTextContent('Use the Send Money option, not Cash Out.')
    expect(within(card).getByTestId('payment-due-deadline')).toHaveTextContent(/^Pay before .+\. An unpaid order is cancelled after that\.$/)
    expect(screen.queryByTestId('payment-instructions')).not.toBeInTheDocument()
  })

  it('tells a cash on delivery shopper about the advance delivery charge', async () => {
    serveCheckout({ advance: true })
    renderRoutes(storefrontRoutes, '/checkout')
    const user = userEvent.setup()
    await fillCheckout(user)
    const notice = await screen.findByTestId('cod-advance-notice')
    expect(notice).toHaveTextContent('Pay the delivery charge of ৳60.00 in advance by bKash / Nagad after placing your order. The rest is paid in cash on delivery.')
    expect(notice.closest('label')).toContainElement(screen.getByRole('radio', { name: /Cash on delivery/ }))
  })

  it('shows no advance notice when none applies', async () => {
    serveCheckout()
    renderRoutes(storefrontRoutes, '/checkout')
    const user = userEvent.setup()
    await fillCheckout(user)
    await waitFor(() => expect(screen.getByTestId('summary-total')).toHaveTextContent('৳960.00'))
    expect(screen.queryByTestId('cod-advance-notice')).not.toBeInTheDocument()
  })
})

/* The payment card ---------------------------------------------------------------------------- */

type ClaimReply = (body: Body) => { status?: number; body?: unknown }

function serveOrder(order: OrderView, reply: ClaimReply, extra: Record<string, unknown> = {}) {
  const claims: { body: Body; key: string | null }[] = []
  mockApi({
    'GET /store/bootstrap': ok((extra.bootstrap as StorefrontBootstrap) ?? bootstrapFixture()),
    'GET /store/account/me': ok(extra.me ?? null),
    'GET /store/cart': ok(cartFixture()),
    'GET /store/wishlist': ok({ items: [] }),
    [`GET /store/orders/${order.number}`]: ok(order),
    [`POST /store/orders/${order.number}/payment-claims`]: (init: RequestInit) => {
      const body = bodyOf(init)
      claims.push({ body, key: headerOf(init, 'Idempotency-Key') })
      return reply(body)
    },
    'POST /store/visits': ok({ recorded: true }),
    ...((extra.routes as Record<string, never>) ?? {}),
  })
  return claims
}

async function sendClaim(user: ReturnType<typeof userEvent.setup>, card: HTMLElement, sender: string, trx: string) {
  const form = within(card).getByRole('form', { name: 'Payment details' })
  await user.clear(within(form).getByLabelText('The number you paid from'))
  await user.type(within(form).getByLabelText('The number you paid from'), sender)
  await user.clear(within(form).getByLabelText('Transaction ID (TrxID)'))
  await user.type(within(form).getByLabelText('Transaction ID (TrxID)'), trx)
  await user.click(within(form).getByRole('button', { name: 'Send payment details' }))
}

describe('the payment card on the order page', () => {
  it('checks the fields, sends the TrxID with the guest token and says the shop is checking it', async () => {
    sessionStorage.setItem('sf:order-token:WEB-000321', 'guest-tok')
    const claims = serveOrder(sendMoneyOrder(), () => created(sendMoneyOrder({ payment_due: due({ claim: submittedClaim }) })))
    renderRoutes(storefrontRoutes, '/order/WEB-000321')
    const user = userEvent.setup()
    const card = await screen.findByTestId('payment-due')

    await user.click(within(card).getByRole('button', { name: 'Send payment details' }))
    expect(within(card).getByLabelText('The number you paid from')).toHaveAccessibleDescription('Please enter the number you paid from.')
    expect(within(card).getByLabelText('Transaction ID (TrxID)')).toHaveAccessibleDescription('Please enter the transaction ID.')
    await sendClaim(user, card, '01911', 'ab1')
    expect(within(card).getByLabelText('The number you paid from')).toHaveAccessibleDescription('Please enter a Bangladeshi mobile number, e.g. 01712345678.')
    expect(within(card).getByLabelText('Transaction ID (TrxID)')).toHaveAccessibleDescription('A transaction ID has 6 to 40 letters and digits, e.g. 9A8B7C6D5E.')
    expect(claims).toEqual([])

    await sendClaim(user, card, '+880 1911-223344', '9a8b 7c6d5e')
    const status = await screen.findByTestId('payment-claim-submitted')
    expect(status).toHaveTextContent('Thank you! We received your payment details.')
    expect(status).toHaveTextContent('We are checking your payment — TrxID 9A8B7C6D5E.')
    await waitFor(() => expect(status).toHaveFocus())
    expect(claims).toHaveLength(1)
    expect(claims[0]!.body).toEqual({ method: 'bkash_manual', sender_phone: '01911223344', transaction_id: '9A8B7C6D5E', token: 'guest-tok' })
    expect(claims[0]!.key).toMatch(/\S{8,}/)
    expect(screen.queryByRole('form', { name: 'Payment details' })).not.toBeInTheDocument()
  })

  it('shows a used TrxID on its field and a pending check as a message', async () => {
    let attempt = 0
    serveOrder(sendMoneyOrder(), () => {
      attempt += 1
      return attempt === 1 ? fail(422, 'TRANSACTION_ID_USED', 'Used') : fail(409, 'PAYMENT_CLAIM_PENDING', 'Pending')
    })
    renderRoutes(storefrontRoutes, '/order/WEB-000321')
    const user = userEvent.setup()
    const card = await screen.findByTestId('payment-due')
    await sendClaim(user, card, '01911223344', '9A8B7C6D5E')
    await waitFor(() => expect(within(card).getByLabelText('Transaction ID (TrxID)')).toHaveAccessibleDescription('This transaction ID has already been used. Please check it and try again.'))
    await sendClaim(user, card, '01911223344', '1A2B3C4D5E')
    expect(await within(card).findByRole('alert')).toHaveTextContent('We are already checking a payment for this order. Please wait for our confirmation.')
  })

  it('shows a rejected TrxID with its reason and the form again; a submitted one without the form', async () => {
    const rejected = { ...submittedClaim, status: 'rejected', reject_reason: 'No such payment in our bKash statement' }
    const claims = serveOrder(sendMoneyOrder({ payment_due: due({ claim: rejected }) }), () => created(sendMoneyOrder({ payment_due: due({ claim: { ...submittedClaim, transaction_id: '1A2B3C4D5E' } }) })))
    renderRoutes(storefrontRoutes, '/order/WEB-000321')
    const user = userEvent.setup()
    const card = await screen.findByTestId('payment-due')
    expect(within(card).getByTestId('payment-claim-rejected')).toHaveTextContent('We could not find your payment with TrxID 9A8B7C6D5E.Reason: No such payment in our bKash statementPlease check the details and send them again.')
    // The sender number is kept from the rejected claim.
    expect(within(card).getByLabelText('The number you paid from')).toHaveValue('01911223344')
    await user.type(within(card).getByLabelText('Transaction ID (TrxID)'), '1A2B3C4D5E')
    await user.click(within(card).getByRole('button', { name: 'Send payment details' }))
    expect(await screen.findByTestId('payment-claim-submitted')).toHaveTextContent('TrxID 1A2B3C4D5E')
    expect(claims[0]!.body).toMatchObject({ transaction_id: '1A2B3C4D5E', sender_phone: '01911223344' })
  })

  it('lets the shopper pick the method for an advance and switches the number', async () => {
    const advance = sendMoneyOrder({ payment_method: 'cod', payment_method_label: 'Cash on delivery', payment_due: due({ amount: '60.00', purpose: 'advance', methods: [BKASH, NAGAD] }) })
    const claims = serveOrder(advance, () => created({ ...advance, payment_due: due({ amount: '60.00', purpose: 'advance', methods: [BKASH, NAGAD], claim: { ...submittedClaim, method: 'nagad_manual' } }) }))
    renderRoutes(storefrontRoutes, '/order/WEB-000321')
    const user = userEvent.setup()
    const card = await screen.findByTestId('payment-due')
    expect(within(card).getByRole('heading', { name: 'Pay the delivery charge in advance' })).toBeInTheDocument()
    expect(card).toHaveTextContent('The rest is paid in cash when your order is delivered.')
    expect(within(card).getByTestId('payment-due-amount')).toHaveTextContent('৳60.00')
    expect(within(card).getByTestId('payment-due-number')).toHaveTextContent('01712345678')
    await user.click(within(card).getByRole('radio', { name: 'Nagad (Send Money)' }))
    expect(within(card).getByTestId('payment-due-account')).toHaveTextContent('Make a Payment to 01812345678 (Merchant)')
    await sendClaim(user, card, '01911223344', '9A8B7C6D5E')
    await screen.findByTestId('payment-claim-submitted')
    expect(claims[0]!.body.method).toBe('nagad_manual')
  })

  it('copies the shop number', async () => {
    serveOrder(sendMoneyOrder(), () => created(sendMoneyOrder()))
    renderRoutes(storefrontRoutes, '/order/WEB-000321')
    const user = userEvent.setup()
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
    const card = await screen.findByTestId('payment-due')
    await user.click(within(card).getByRole('button', { name: /Copy number/ }))
    expect(writeText).toHaveBeenCalledWith('01712345678')
    expect(await within(card).findByTestId('payment-due-copy')).toHaveTextContent('Copied')
  })

  it('keeps the bank transfer details for orders with nothing due by Send Money', async () => {
    serveOrder(orderFixture({ payment_method: 'bank_transfer', payment_instructions: 'Pay to account 123' }), () => created(orderFixture()))
    renderRoutes(storefrontRoutes, '/order/WEB-000001')
    expect(await screen.findByTestId('payment-instructions')).toHaveTextContent('Pay to account 123')
    expect(screen.queryByTestId('payment-due')).not.toBeInTheDocument()
  })
})

describe('the payment card on the track page and in the account', () => {
  const tracked = (patch: Partial<TrackedOrder> = {}): TrackedOrder => ({
    number: 'WEB-000321',
    status: 'pending_payment',
    payment_method: 'bkash_manual',
    payment_status: 'unpaid',
    placed_at: '2026-11-24T10:00:00+06:00',
    total: '960.00',
    item_count: 2,
    history: [{ status: 'pending_payment', at: '2026-11-24T10:00:00+06:00' }],
    shipment: null,
    payment_due: due(),
    ...patch,
  })

  it('sends the TrxID with the mobile number the order was found by', async () => {
    const claims = serveOrder(sendMoneyOrder(), () => created(sendMoneyOrder({ payment_due: due({ claim: submittedClaim }) })), {
      routes: { 'GET /store/orders/track': ok(tracked()) },
    })
    renderRoutes(storefrontRoutes, '/track-order?number=WEB-000321')
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText('Mobile number'), '01711223344')
    await user.click(screen.getByRole('button', { name: 'Track order' }))
    expect(await screen.findByTestId('tracked-payment')).toHaveTextContent('bKash (Send Money) · Awaiting payment')
    const card = await screen.findByTestId('payment-due')
    await sendClaim(user, card, '01911223344', '9A8B7C6D5E')
    expect(await screen.findByTestId('payment-claim-submitted')).toHaveTextContent('TrxID 9A8B7C6D5E')
    expect(claims[0]!.body).toEqual({ method: 'bkash_manual', sender_phone: '01911223344', transaction_id: '9A8B7C6D5E', phone: '01711223344' })
  })

  it('shows a partly paid order as such', async () => {
    serveOrder(sendMoneyOrder(), () => created(sendMoneyOrder()), { routes: { 'GET /store/orders/track': ok(tracked({ payment_method: 'cod', payment_status: 'partially_paid', status: 'confirmed', payment_due: null })) } })
    renderRoutes(storefrontRoutes, '/track-order?number=WEB-000321')
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText('Mobile number'), '01711223344')
    await user.click(screen.getByRole('button', { name: 'Track order' }))
    expect(await screen.findByTestId('tracked-payment')).toHaveTextContent('Cash on delivery · Partly paid')
    expect(screen.queryByTestId('payment-due')).not.toBeInTheDocument()
  })

  it('lets the signed-in owner pay from the account order page without a token', async () => {
    const order: AccountOrder = { ...sendMoneyOrder(), lines: sendMoneyOrder().lines.map((line) => ({ ...line, review: null, reviewable: false })), can_cancel: true }
    const claims = serveOrder(sendMoneyOrder(), () => created(sendMoneyOrder({ payment_due: due({ claim: submittedClaim }) })), {
      me: customerFixture(),
      routes: { 'GET /store/account/orders/WEB-000321': ok(order) },
    })
    renderRoutes(storefrontRoutes, '/account/orders/WEB-000321')
    const user = userEvent.setup()
    const card = await screen.findByTestId('payment-due')
    await sendClaim(user, card, '01911223344', '9A8B7C6D5E')
    expect(await screen.findByTestId('payment-claim-submitted')).toBeInTheDocument()
    expect(claims[0]!.body).toEqual({ method: 'bkash_manual', sender_phone: '01911223344', transaction_id: '9A8B7C6D5E' })
  })
})

describe('in Bangla', () => {
  it('translates the card, the error codes and the partly paid state', async () => {
    let attempt = 0
    serveOrder(
      sendMoneyOrder({ payment_status: 'partially_paid', payment_method: 'cod', payment_due: due({ purpose: 'advance', amount: '60.00' }) }),
      () => {
        attempt += 1
        return attempt === 1 ? fail(422, 'TRANSACTION_ID_USED', 'Used') : fail(422, 'PAYMENT_NOT_DUE', 'Not due')
      },
      { bootstrap: bilingualBootstrap({}, { locale: 'bn' }) },
    )
    renderRoutes(storefrontRoutes, '/order/WEB-000321?lang=bn')
    const user = userEvent.setup()
    const card = await screen.findByTestId('payment-due')
    expect(within(card).getByRole('heading', { name: 'ডেলিভারি চার্জ অগ্রিম পরিশোধ করুন' })).toBeInTheDocument()
    expect(screen.getByTestId('order-payment')).toHaveTextContent('আংশিক পরিশোধিত')
    expect(within(card).getByTestId('payment-due-account')).toHaveTextContent('01712345678 (পার্সোনাল) নম্বরে সেন্ড মানি করুন')
    const form = within(card).getByRole('form', { name: 'পেমেন্টের তথ্য' })
    await user.type(within(form).getByLabelText('যে নম্বর থেকে টাকা পাঠিয়েছেন'), '01911223344')
    await user.type(within(form).getByLabelText('ট্রানজেকশন আইডি (TrxID)'), '9A8B7C6D5E')
    await user.click(within(form).getByRole('button', { name: 'পেমেন্টের তথ্য পাঠান' }))
    await waitFor(() => expect(within(form).getByLabelText('ট্রানজেকশন আইডি (TrxID)')).toHaveAccessibleDescription('এই ট্রানজেকশন আইডি আগেই ব্যবহার করা হয়েছে। যাচাই করে আবার চেষ্টা করুন।'))
    await user.click(within(form).getByRole('button', { name: 'পেমেন্টের তথ্য পাঠান' }))
    expect(await within(card).findByRole('alert')).toHaveTextContent('এই অর্ডারে এখন পরিশোধের কিছু নেই।')
  })
})

/* Landing-page order form ----------------------------------------------------------------------- */

const PRODUCT_ID = '0199a5c1-0000-7000-8000-00000000a001'

function landingPage(): BuilderPage {
  const data: OrderFormData = {
    product: productDetail({ id: PRODUCT_ID }),
    upsell: null,
    payment_methods: [
      { code: 'cod', display_name: 'Cash on delivery' },
      { code: 'bkash_manual', display_name: 'bKash (Send Money)', instructions: null, account_number: '01712345678', account_type: 'agent' },
    ],
    cod_enabled: true,
    guest_checkout: true,
    checkout_available: true,
    shipping: { methods: [home], districts: { '47': ['sm-home'] } },
  }
  const doc = documentOf([elementNode('order_form', 'e_order', { product_id: PRODUCT_ID, payment: 'store_methods' })])
  return payloadOf(doc, { key: 'landing:eid-sale', title: 'Eid sale', source: 'published', data: { e_order: data } })
}

function serveLanding() {
  const places: Body[] = []
  mockApi({
    'GET /store/bootstrap': ok(bootstrapFixture()),
    'GET /store/account/me': ok(null),
    'GET /store/cart': ok(cartFixture()),
    'GET /store/wishlist': ok({ items: [] }),
    'GET /store/builder/popups': ok({ popups: [], never_on: [] }),
    'GET /store/builder/pages/eid-sale': ok(landingPage()),
    'GET /store/geo/divisions': ok([{ id: 3, name: 'Dhaka', name_bn: null }]),
    'GET /store/geo/districts': ok([{ id: 47, division_id: 3, name: 'Dhaka', name_bn: null }]),
    'POST /store/checkout/direct/preview': (init) => {
      const body = bodyOf(init)
      const served = body.address !== undefined
      return ok(
        previewFixture({
          lines: [cartLine('l-0', { variant_id: 'v-red-m', quantity: '1', unit_price: '450.00', line_total: '450.00' })],
          subtotal: '450.00',
          shipping_methods: served ? [home] : [],
          shipping_method_id: served ? 'sm-home' : null,
          shipping_total: served ? '60.00' : '0.00',
          total: served ? '510.00' : '450.00',
          payment_method: (body.payment_method as 'cod') ?? null,
          cod_advance: served ? { amount: '60.00', methods: [BKASH] } : null,
        }),
      )
    },
    'POST /store/visits': ok({ recorded: true }),
    'POST /store/checkout/direct': (init) => {
      places.push(bodyOf(init))
      return created({ order: sendMoneyOrder({ number: 'WEB-000777', total: '510.00', payment_due: due({ amount: '510.00' }) }), access_token: 'tok', order_url: '/order/WEB-000777?token=tok' })
    },
  })
  return places
}

describe('landing-page order form with Send Money', () => {
  it('offers Send Money with the shop number, notes the advance for cash on delivery and shows the payment card after placing', async () => {
    const places = serveLanding()
    renderRoutes(storefrontRoutes, '/p/eid-sale')
    const user = userEvent.setup()
    const form = await screen.findByRole('form', { name: 'Order now' })
    await user.type(within(form).getByRole('textbox', { name: /^Your name/ }), 'Karim Uddin')
    await user.type(within(form).getByRole('textbox', { name: /^Mobile number/ }), '01811223344')
    await user.selectOptions(within(form).getByRole('combobox', { name: /^Division/ }), '3')
    await waitFor(() => expect(within(form).getByRole('combobox', { name: /^District/ })).toBeEnabled())
    await user.selectOptions(within(form).getByRole('combobox', { name: /^District/ }), '47')
    await user.type(within(form).getByRole('textbox', { name: /^Full address/ }), 'Road 3, House 9')
    await waitFor(() => expect(within(form).getByRole('radio', { name: /Home delivery/ })).toBeChecked())

    expect(await within(form).findByTestId('cod-advance-notice')).toHaveTextContent('Pay the delivery charge of ৳60.00 in advance by bKash after placing your order.')
    const bkash = within(form).getByRole('radio', { name: /bKash \(Send Money\)/ })
    expect(bkash.closest('label')).toHaveTextContent('Send the money to 01712345678 (Agent) after placing the order.')
    await user.click(bkash)
    await waitFor(() => expect(within(form).getByTestId('summary-total')).toHaveTextContent('৳510.00'))
    await user.click(within(form).getByRole('button', { name: 'Confirm order' }))

    expect(await screen.findByTestId('order-form-thanks')).toHaveTextContent('WEB-000777')
    expect(places[0]!.payment_method).toBe('bkash_manual')
    const card = screen.getByTestId('payment-due')
    expect(within(card).getByTestId('payment-due-amount')).toHaveTextContent('৳510.00')
    expect(within(card).getByRole('form', { name: 'Payment details' })).toBeInTheDocument()
  })
})
