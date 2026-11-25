import { useState } from 'react'
import { Loader2Icon, PlusIcon, Trash2Icon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { pointsFor, pointsValue } from '@/features/loyalty/api'
import { PAYMENT_METHODS, type PaymentMethod, type PricedCart } from '@/features/pos/api'
import { GiftCardCodeField, StoreCreditNote } from '@/features/pos/components/stored-value-tender'
import { allocate, checkedCard, storedValueProblem, type TenderRow } from '@/features/pos/stored-value-tenders'
import { lookupGiftCard, normalizeGiftCode, tenderProblem } from '@/features/pos/stored-value-api'
import { ApiError } from '@/lib/api/client'
import { compareDecimal, formatMoney, MONEY_PATTERN, subtractDecimal, sumDecimals } from '@/lib/money'

type Tender = TenderRow

let tenderIds = 0
const tender = (method: PaymentMethod, amount: string): Tender => ({ id: ++tenderIds, method, amount, reference: '' })

/** POS1b: the selected customer's store credit (`balance` null = not known to this user). */
export type StoreCreditTender = { balance: string | null }

/** The selected customer's redeemable points, when the loyalty program is on. */
export type LoyaltyTender = { points: number; pointValue: string; minRedeemPoints: number }

const METHODS = Object.keys(PAYMENT_METHODS) as PaymentMethod[]

/** Whole points whose value fits in `amount` (floor). */
function maxWholePoints(amount: string, pointValue: string): number {
  const cents = (v: string) => {
    const [i = '0', f = ''] = v.split('.')
    return BigInt(i + (f + '00').slice(0, 2))
  }
  const value = cents(pointValue)
  return value === 0n ? 0 : Number(cents(amount) / value)
}

/** Why a loyalty tender is not acceptable, or null. */
function loyaltyProblem(amount: string, loyalty: LoyaltyTender | null | undefined, currency: string): string | null {
  if (!loyalty) return 'This customer cannot pay with points.'
  const points = pointsFor(amount, loyalty.pointValue)
  if (points === null) return `Points pay in steps of ${formatMoney(loyalty.pointValue, currency)} (one point).`
  if (points < loyalty.minRedeemPoints) return `Redeem at least ${loyalty.minRedeemPoints} points.`
  if (points > loyalty.points) return `${loyalty.points} points available (${formatMoney(pointsValue(loyalty.points, loyalty.pointValue), currency)}).`
  return null
}

/** Smallest multiple of `step` (whole currency units) that is ≥ amount, e.g. 1,987.20 → 2,000. */
function roundUp(amount: string, step: number): string {
  const cents = BigInt(amount.replace('.', ''))
  const unit = BigInt(step * 100)
  const up = ((cents + unit - 1n) / unit) * unit
  return `${up / 100n}.00`
}

const positive = (v: string) => MONEY_PATTERN.test(v.trim()) && !/^0+(\.0+)?$/.test(v.trim())

/**
 * Takes the payments for a priced cart: any mix of cash, card, mobile banking, loyalty points and
 * (POS1b) the customer's store credit or gift cards (checked by code first). Shows what
 * is still due or the change to hand back. The server settles the payments again.
 */
export function PaymentDialog({
  open,
  onOpenChange,
  priced,
  canCredit,
  loyalty,
  storeCredit,
  checkoutError,
  pending,
  onSubmit,
  exchange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  priced: PricedCart
  canCredit: boolean
  loyalty?: LoyaltyTender | null
  /** POS1b: offered only with a customer on the sale. */
  storeCredit?: StoreCreditTender | null
  /** POS1b: the last checkout refusal; store credit / gift card refusals show at their tender. */
  checkoutError?: unknown
  pending: boolean
  onSubmit: (payments: { method: PaymentMethod; amount: string; reference: string | null }[]) => void
  /** POS1c: an exchange — the returned items pay `applied` of the total; the tenders settle the rest. */
  exchange?: { applied: string; number: string } | null
}) {
  const total = exchange ? subtractDecimal(priced.total, exchange.applied, 2) : priced.total
  const [tenders, setTenders] = useState<Tender[]>(() => [tender('cash', total)])
  const [touched, setTouched] = useState(false)
  // POS1b: a refusal stays at its tender until a stored-value tender is changed.
  const [dismissedError, setDismissedError] = useState<unknown>(null)
  const [focusId, setFocusId] = useState<number | null>(null)
  const problem = checkoutError && checkoutError !== dismissedError ? tenderProblem(checkoutError, priced.currency) : null

  const valid = tenders.filter((t) => positive(t.amount))
  const tendered = sumDecimals(valid.map((t) => t.amount))
  const remaining = subtractDecimal(total, tendered, 2)
  const due = remaining.startsWith('-') ? '0.00' : remaining
  const change = remaining.startsWith('-') ? remaining.slice(1) : '0.00'
  const nonCash = sumDecimals(valid.filter((t) => t.method !== 'cash').map((t) => t.amount))
  const hasDue = compareDecimal(due, '0') > 0
  const canUsePoints = !!loyalty && loyalty.points >= Math.max(loyalty.minRedeemPoints, 1)
  const creditBalance = storeCredit?.balance ?? null
  const canUseCredit = !!priced.customer && !!storeCredit && (creditBalance === null || compareDecimal(creditBalance, '0') > 0)
  const methods = METHODS.filter((m) =>
    (m !== 'loyalty_points' || canUsePoints || tenders.some((t) => t.method === m))
    && (m !== 'store_credit' || canUseCredit || tenders.some((t) => t.method === m)))
  const pointsTender = valid.find((t) => t.method === 'loyalty_points')

  const tenderError =
    tenders.some((t) => t.amount.trim() !== '' && !positive(t.amount)) ? 'Enter amounts greater than zero with up to 2 decimals.'
    : tenders.filter((t) => t.method === 'loyalty_points').length > 1 ? 'Use one loyalty points payment.'
    : pointsTender ? loyaltyProblem(pointsTender.amount.trim(), loyalty, priced.currency)
    : storedValueProblem(tenders, { hasCustomer: !!priced.customer, creditBalance, currency: priced.currency })
  const error =
    tenderError ? tenderError
    : compareDecimal(nonCash, total) > 0 ? 'Card, mobile, points, store credit and gift card payments cannot exceed the total; only cash gives change.'
    : hasDue && !priced.customer ? 'Collect the full amount, or choose a customer to leave the rest due.'
    : hasDue && !canCredit ? 'You are not allowed to sell on credit; collect the full amount.'
    : hasDue && compareDecimal(due, priced.customer?.credit.available ?? '0') > 0 ? `Only ${formatMoney(priced.customer?.credit.available ?? '0', priced.currency)} of credit is available for ${priced.customer?.name}.`
    : null

  const set = (i: number, patch: Partial<Tender>) => setTenders((ts) => ts.map((t, j) => (j === i ? { ...t, ...patch } : t)))

  /** POS1b: a stored-value tender changed, so its checkout refusal no longer applies. */
  const touchStoredValue = () => { if (checkoutError) setDismissedError(checkoutError) }

  const changeMethod = (i: number, method: PaymentMethod) => {
    const current = tenders[i]
    if (!current || current.method === method) return
    if (current.method === 'store_credit' || current.method === 'gift_card') touchStoredValue()
    // The gift card code never moves to another method's reference.
    const reset = current.method === 'gift_card' || method === 'gift_card' ? { reference: '', check: undefined } : {}
    if (method === 'store_credit') {
      touchStoredValue()
      setTenders((ts) => allocate(ts.map((t, j) => (j === i ? { ...t, ...reset, method } : t)), current.id, creditBalance, total))
    } else if (method === 'gift_card') {
      setFocusId(current.id)
      set(i, { ...reset, method, amount: '' })
    } else {
      set(i, { ...reset, method })
    }
  }

  /** Adds a store credit tender up to the balance; the first cash / card tender keeps the rest. */
  const addStoreCredit = () => {
    const row = tender('store_credit', '')
    touchStoredValue()
    setTenders((ts) => allocate([row, ...ts], row.id, creditBalance, total))
  }

  const addGiftCard = () => {
    const row = tender('gift_card', '')
    setFocusId(row.id)
    setTenders((ts) => [...ts, row])
  }

  /** Looks the typed code up; a usable card takes up to its balance of what is still due. */
  const checkGiftCard = (id: number) => {
    const row = tenders.find((t) => t.id === id)
    const code = row ? normalizeGiftCode(row.reference) : ''
    if (!code) return
    touchStoredValue()
    const update = (patch: (t: Tender) => Tender) => setTenders((ts) => ts.map((t) => (t.id === id && normalizeGiftCode(t.reference) === code ? patch(t) : t)))
    update((t) => ({ ...t, check: { status: 'checking', code } }))
    lookupGiftCard(code).then(
      (card) => setTenders((ts) => {
        const current = ts.find((t) => t.id === id)
        if (!current || normalizeGiftCode(current.reference) !== code) return ts
        const next = ts.map((t) => (t.id === id ? { ...t, check: { status: 'checked' as const, code, card } } : t))
        const usable = card.usable && (!card.currency || card.currency === priced.currency) && card.balance !== null
        return usable ? allocate(next, id, card.balance, total) : next
      }),
      (failure: unknown) => update((t) => ({
        ...t,
        check: {
          status: 'failed',
          code,
          message: failure instanceof ApiError && failure.status === 429 ? 'Too many gift card checks; wait a minute and try again.' : failure instanceof Error ? failure.message : 'The gift card could not be checked.',
        },
      })),
    )
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    setTouched(true)
    if (error || pending) return
    onSubmit(valid.map((t) => ({
      method: t.method,
      amount: t.amount.trim(),
      reference: t.method === 'card' || t.method === 'mobile_banking' ? t.reference.trim() || null
        : t.method === 'gift_card' ? normalizeGiftCode(t.reference)
        : null,
    })))
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Payment</DialogTitle>
          <DialogDescription>
            Total to pay <span className="font-mono font-semibold text-foreground">{formatMoney(total, priced.currency)}</span>
            {priced.customer && ` · ${priced.customer.name}`}
            {exchange && (
              <span className="block" data-testid="exchange-credit">
                New items {formatMoney(priced.total, priced.currency)} · Exchange credit ({exchange.number}) −{formatMoney(exchange.applied, priced.currency)}
              </span>
            )}
          </DialogDescription>
        </DialogHeader>
        <form id="payment-form" onSubmit={submit} noValidate className="flex flex-col gap-3">
          {tenders.map((t, i) => (
            <div key={t.id} className="grid grid-cols-[9rem_1fr_auto] items-start gap-2">
              <Select value={t.method} onValueChange={(v) => changeMethod(i, v as PaymentMethod)}>
                <SelectTrigger className="w-full" aria-label={`Method of payment ${i + 1}`}><SelectValue /></SelectTrigger>
                <SelectContent>{methods.map((m) => <SelectItem key={m} value={m}>{PAYMENT_METHODS[m]}</SelectItem>)}</SelectContent>
              </Select>
              <div className="flex flex-col gap-1">
                {t.method === 'gift_card' && (
                  <GiftCardCodeField
                    index={i}
                    tender={t}
                    currency={priced.currency}
                    autoFocus={focusId === t.id}
                    problem={problem}
                    onCodeChange={(reference) => { touchStoredValue(); set(i, { reference }) }}
                    onCheck={() => checkGiftCard(t.id)}
                  />
                )}
                <Input
                  aria-label={`Amount of payment ${i + 1}`}
                  inputMode="decimal"
                  autoFocus={i === 0 && focusId === null}
                  className="font-mono"
                  value={t.amount}
                  disabled={t.method === 'gift_card' && !checkedCard(t)?.usable && t.amount === ''}
                  onChange={(e) => {
                    if (t.method === 'store_credit' || t.method === 'gift_card') touchStoredValue()
                    set(i, { amount: e.target.value })
                  }}
                  onFocus={(e) => e.target.select()}
                />
                {t.method === 'store_credit' && <StoreCreditNote balance={creditBalance} currency={priced.currency} problem={problem} />}
                {(t.method === 'card' || t.method === 'mobile_banking') && (
                  <Input aria-label={`Reference of payment ${i + 1}`} placeholder="Card / transaction reference" value={t.reference} onChange={(e) => set(i, { reference: e.target.value })} />
                )}
                {t.method === 'loyalty_points' && loyalty && (
                  <p className="text-xs text-muted-foreground">
                    {pointsFor(t.amount.trim(), loyalty.pointValue) ?? '?'} of {loyalty.points} points · 1 point = {formatMoney(loyalty.pointValue, priced.currency)}
                  </p>
                )}
              </div>
              <Button type="button" variant="ghost" size="icon" aria-label={`Remove payment ${i + 1}`} disabled={tenders.length === 1} onClick={() => {
                if (t.method === 'store_credit' || t.method === 'gift_card') touchStoredValue()
                setTenders((ts) => ts.filter((_, j) => j !== i))
              }}>
                <Trash2Icon />
              </Button>
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setTenders((ts) => [...ts, tender('card', hasDue ? due : '')])}>
              <PlusIcon data-icon="inline-start" /> Split payment
            </Button>
            {canUseCredit && !tenders.some((t) => t.method === 'store_credit') && (
              <Button type="button" variant="outline" size="sm" onClick={addStoreCredit}>
                Store credit{creditBalance !== null && ` (${formatMoney(creditBalance)})`}
              </Button>
            )}
            <Button type="button" variant="outline" size="sm" onClick={addGiftCard}>
              Gift card
            </Button>
            {canUsePoints && loyalty && !tenders.some((t) => t.method === 'loyalty_points') && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  // As many whole points as the balance and the total allow; the rest stays in the first tender.
                  const affordable = Math.min(loyalty.points, maxWholePoints(total, loyalty.pointValue))
                  if (affordable < Math.max(loyalty.minRedeemPoints, 1)) return
                  const amount = pointsValue(affordable, loyalty.pointValue)
                  const pointsRow: Tender = tender('loyalty_points', amount)
                  setTenders((ts) => [pointsRow, ...ts.map((t, j) => (j === 0 ? { ...t, amount: subtractDecimal(total, amount, 2) } : t))].filter((t) => t === pointsRow || !/^0+(\.0+)?$/.test(t.amount)))
                }}
              >
                Use points ({loyalty.points})
              </Button>
            )}
            {tenders.length === 1 && tenders[0]?.method === 'cash' && [100, 500, 1000].map((step) => {
              const amount = roundUp(total, step)
              return (
                <Button key={step} type="button" variant="secondary" size="sm" className="font-mono" onClick={() => set(0, { amount })}>
                  {formatMoney(amount)}
                </Button>
              )
            })}
          </div>

          <dl className="grid grid-cols-2 gap-1 rounded-md border p-3 text-sm">
            <dt className="text-muted-foreground">Tendered</dt>
            <dd className="text-right font-mono">{formatMoney(tendered, priced.currency)}</dd>
            {hasDue ? (
              <>
                <dt className="font-medium text-amber-600 dark:text-amber-400">Balance due</dt>
                <dd className="text-right font-mono font-semibold text-amber-600 dark:text-amber-400">{formatMoney(due, priced.currency)}</dd>
              </>
            ) : (
              <>
                <dt className="font-medium">Change</dt>
                <dd className="text-right font-mono text-lg font-semibold" data-testid="change-due">{formatMoney(change, priced.currency)}</dd>
              </>
            )}
          </dl>
          {touched && error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          {!touched && error && hasDue && <p className="text-sm text-muted-foreground">{error}</p>}
        </form>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Back to cart</Button>
          <Button type="submit" form="payment-form" disabled={pending}>
            {pending && <Loader2Icon data-icon="inline-start" className="animate-spin" />}
            {exchange ? 'Complete exchange' : 'Complete sale'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
