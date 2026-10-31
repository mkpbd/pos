import { useState } from 'react'
import { Loader2Icon, PlusIcon, Trash2Icon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { PAYMENT_METHODS, type PaymentMethod, type PricedCart } from '@/features/pos/api'
import { compareDecimal, formatMoney, MONEY_PATTERN, subtractDecimal, sumDecimals } from '@/lib/money'

type Tender = { method: PaymentMethod; amount: string; reference: string }

const METHODS = Object.keys(PAYMENT_METHODS) as PaymentMethod[]

/** Smallest multiple of `step` (whole currency units) that is ≥ amount, e.g. 1,987.20 → 2,000. */
function roundUp(amount: string, step: number): string {
  const cents = BigInt(amount.replace('.', ''))
  const unit = BigInt(step * 100)
  const up = ((cents + unit - 1n) / unit) * unit
  return `${up / 100n}.00`
}

const positive = (v: string) => MONEY_PATTERN.test(v.trim()) && !/^0+(\.0+)?$/.test(v.trim())

/**
 * Takes the payments for a priced cart: any mix of cash, card and mobile banking. Shows what
 * is still due or the change to hand back. The server settles the payments again.
 */
export function PaymentDialog({
  open,
  onOpenChange,
  priced,
  canCredit,
  pending,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  priced: PricedCart
  canCredit: boolean
  pending: boolean
  onSubmit: (payments: { method: PaymentMethod; amount: string; reference: string | null }[]) => void
}) {
  const total = priced.total
  const [tenders, setTenders] = useState<Tender[]>([{ method: 'cash', amount: total, reference: '' }])
  const [touched, setTouched] = useState(false)

  const valid = tenders.filter((t) => positive(t.amount))
  const tendered = sumDecimals(valid.map((t) => t.amount))
  const remaining = subtractDecimal(total, tendered, 2)
  const due = remaining.startsWith('-') ? '0.00' : remaining
  const change = remaining.startsWith('-') ? remaining.slice(1) : '0.00'
  const nonCash = sumDecimals(valid.filter((t) => t.method !== 'cash').map((t) => t.amount))
  const hasDue = compareDecimal(due, '0') > 0

  const error =
    tenders.some((t) => t.amount.trim() !== '' && !positive(t.amount)) ? 'Enter amounts greater than zero with up to 2 decimals.'
    : compareDecimal(nonCash, total) > 0 ? 'Card and mobile payments cannot exceed the total; only cash gives change.'
    : hasDue && !priced.customer ? 'Collect the full amount, or choose a customer to leave the rest due.'
    : hasDue && !canCredit ? 'You are not allowed to sell on credit; collect the full amount.'
    : hasDue && compareDecimal(due, priced.customer?.credit.available ?? '0') > 0 ? `Only ${formatMoney(priced.customer?.credit.available ?? '0', priced.currency)} of credit is available for ${priced.customer?.name}.`
    : null

  const set = (i: number, patch: Partial<Tender>) => setTenders((ts) => ts.map((t, j) => (j === i ? { ...t, ...patch } : t)))

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    setTouched(true)
    if (error || pending) return
    onSubmit(valid.map((t) => ({ method: t.method, amount: t.amount.trim(), reference: t.method === 'cash' ? null : t.reference.trim() || null })))
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Payment</DialogTitle>
          <DialogDescription>
            Total to pay <span className="font-mono font-semibold text-foreground">{formatMoney(total, priced.currency)}</span>
            {priced.customer && ` · ${priced.customer.name}`}
          </DialogDescription>
        </DialogHeader>
        <form id="payment-form" onSubmit={submit} noValidate className="flex flex-col gap-3">
          {tenders.map((t, i) => (
            <div key={i} className="grid grid-cols-[9rem_1fr_auto] items-start gap-2">
              <Select value={t.method} onValueChange={(v) => set(i, { method: v as PaymentMethod })}>
                <SelectTrigger className="w-full" aria-label={`Method of payment ${i + 1}`}><SelectValue /></SelectTrigger>
                <SelectContent>{METHODS.map((m) => <SelectItem key={m} value={m}>{PAYMENT_METHODS[m]}</SelectItem>)}</SelectContent>
              </Select>
              <div className="flex flex-col gap-1">
                <Input
                  aria-label={`Amount of payment ${i + 1}`}
                  inputMode="decimal"
                  autoFocus={i === 0}
                  className="font-mono"
                  value={t.amount}
                  onChange={(e) => set(i, { amount: e.target.value })}
                  onFocus={(e) => e.target.select()}
                />
                {t.method !== 'cash' && (
                  <Input aria-label={`Reference of payment ${i + 1}`} placeholder="Card / transaction reference" value={t.reference} onChange={(e) => set(i, { reference: e.target.value })} />
                )}
              </div>
              <Button type="button" variant="ghost" size="icon" aria-label={`Remove payment ${i + 1}`} disabled={tenders.length === 1} onClick={() => setTenders((ts) => ts.filter((_, j) => j !== i))}>
                <Trash2Icon />
              </Button>
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setTenders((ts) => [...ts, { method: 'card', amount: hasDue ? due : '', reference: '' }])}>
              <PlusIcon data-icon="inline-start" /> Split payment
            </Button>
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
            Complete sale
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
