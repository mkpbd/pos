import { useCallback, useRef, useState } from 'react'
import { Loader2Icon, PlusIcon, Trash2Icon } from 'lucide-react'
import { FormField } from '@/components/common/form-field'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { CustomerRef } from '@/features/pos/cart-store'
import { SlipPrinter, StoredValueSlip, type SlipData } from '@/features/pos/components/stored-value-slip'
import { slipDocument } from '@/features/pos/printing/receipt-document'
import { TillPrintButton } from '@/features/pos/printing/till-print-button'
import {
  CARD_NUMBER_PATTERN,
  codeFingerprint,
  formatGiftCode,
  maskedCard,
  normalizeGiftCode,
  TILL_MONEY_METHODS,
  tillReceiptFormat,
  useSellGiftCardMutation,
  type SellGiftCardInput,
  type SoldGiftCard,
  type TillMoneyMethod,
} from '@/features/pos/stored-value-api'
import { compareDecimal, formatMoney, MONEY_PATTERN, sumDecimals } from '@/lib/money'

const MIN_VALUE = '10'
const MAX_VALUE = '1000000'
const METHODS = Object.keys(TILL_MONEY_METHODS) as TillMoneyMethod[]

type Row = { method: TillMoneyMethod; amount: string; reference: string }

export type TillContext = {
  storeId: string | null
  organization: string | null
  branch: string | null
  cashier: string | null
  currency: string
  /** The cashier's register session is open in this branch (cash needs it). */
  cashReady: boolean
}

/** Why the typed card value is not acceptable, or null. */
function valueProblem(value: string): string | null {
  const v = value.trim()
  if (v === '') return 'Enter the card value.'
  if (!MONEY_PATTERN.test(v)) return 'An amount with up to 2 decimals.'
  if (compareDecimal(v, MIN_VALUE) < 0 || compareDecimal(v, MAX_VALUE) > 0) return `Between ${formatMoney(MIN_VALUE)} and ${formatMoney(MAX_VALUE)}.`
  return null
}

/**
 * POS1b: sells a gift card at the till (not a sale: no tax, no stock). The money comes in like any
 * till payment; the card's full code is shown — and printable — once, then never again.
 */
export function SellGiftCardDialog({ till, customer, onClose }: { till: TillContext; customer: CustomerRef | null; onClose: () => void }) {
  const sell = useSellGiftCardMutation()
  const [amount, setAmount] = useState('')
  const [cardNumber, setCardNumber] = useState('')
  const [neverExpires, setNeverExpires] = useState(false)
  const [linkCustomer, setLinkCustomer] = useState(customer !== null)
  const [rows, setRows] = useState<Row[]>([{ method: 'cash', amount: '', reference: '' }])
  const [touched, setTouched] = useState(false)
  const [sold, setSold] = useState<(SoldGiftCard & { at: string }) | null>(null)
  const [printing, setPrinting] = useState(false)
  const donePrinting = useCallback(() => setPrinting(false), [])
  // Retrying the same request (e.g. after a timeout) reuses its key so the card is never sold twice.
  const pending = useRef<{ fingerprint: string; key: string } | null>(null)

  const split = rows.length > 1
  const payments = rows.map((r) => ({ method: r.method, amount: split ? r.amount.trim() : amount.trim(), reference: r.method === 'cash' ? null : r.reference.trim() || null }))
  const number = normalizeGiftCode(cardNumber)

  const amountError = valueProblem(amount)
  const numberError = number !== '' && !CARD_NUMBER_PATTERN.test(number) ? 'A card number has 8–20 letters A–Z or digits.' : null
  const paymentsError =
    split && payments.some((p) => !MONEY_PATTERN.test(p.amount) || compareDecimal(p.amount || '0', '0') <= 0) ? 'Enter each payment amount.'
    : split && !amountError && compareDecimal(sumDecimals(payments.map((p) => p.amount)), amount.trim()) !== 0 ? `The payments must add up to ${formatMoney(amount.trim(), till.currency)}.`
    : payments.some((p) => p.method === 'cash') && !till.cashReady ? 'Cash needs an open register session; open one first or take card / mobile.'
    : null
  const error = amountError ?? numberError ?? paymentsError ?? (till.storeId ? null : 'Choose the store you sell from first.')

  const setRow = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)))

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    setTouched(true)
    if (error || sell.isPending || !till.storeId) return
    const input: SellGiftCardInput = { store_id: till.storeId, amount: amount.trim(), payments }
    if (linkCustomer && customer) input.customer_id = customer.id
    if (number) input.code = number
    if (neverExpires) Object.assign(input, { expires_at: null, never_expires: true })
    const fingerprint = JSON.stringify({ ...input, code: number ? codeFingerprint(number) : undefined })
    const key = pending.current?.fingerprint === fingerprint ? pending.current.key : crypto.randomUUID()
    pending.current = { fingerprint, key }
    sell.mutate({ input, idempotencyKey: key }, {
      onSuccess: (result) => { pending.current = null; setSold({ ...result, at: new Date().toISOString() }) },
    })
  }

  const close = () => { if (!sell.isPending) onClose() }

  if (sold) {
    const card = sold.gift_card
    const slip: SlipData = {
      organization: till.organization,
      branch: till.branch,
      title: 'Gift card sale',
      number: sold.receipt_number,
      at: sold.at,
      cashier: till.cashier,
      code: formatGiftCode(card.code),
      rows: [
        { label: 'Gift card value', value: formatMoney(card.balance, card.currency), bold: true },
        ...payments.map((p) => ({ label: `${TILL_MONEY_METHODS[p.method]}${p.reference ? ` (${p.reference})` : ''}`, value: formatMoney(p.amount) })),
        { label: 'Expires', value: card.expires_at ? new Date(card.expires_at).toLocaleDateString() : 'Never' },
        ...(card.customer ? [{ label: 'Customer', value: card.customer.name }] : []),
      ],
      footer: 'Keep this code safe: it pays like cash.',
    }
    const format = tillReceiptFormat()
    return (
      <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
        <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Gift card sold</DialogTitle>
            <DialogDescription>
              Card {maskedCard(card.code_last4)} · {sold.receipt_number}. The full code is shown only now — print it or hand it over before closing.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-center overflow-x-auto rounded-md border bg-muted/40 p-3">
            <div className="shadow-sm"><StoredValueSlip slip={slip} format={format} /></div>
          </div>
          <DialogFooter>
            <TillPrintButton
              job={{ key: `slip:${sold.receipt_number}`, build: () => slipDocument(slip), cash: payments.some((p) => p.method === 'cash') }}
              auto
              onBrowserPrint={() => setPrinting(true)}
              disabled={printing}
            />
            <Button autoFocus onClick={onClose}>Done</Button>
          </DialogFooter>
          {printing && <SlipPrinter slip={slip} format={format} onDone={donePrinting} />}
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) close() }}>
      <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Sell gift card</DialogTitle>
          <DialogDescription>Not a sale: no tax or stock. The card pays for later sales up to its value.</DialogDescription>
        </DialogHeader>
        <form id="sell-gift-card-form" onSubmit={submit} noValidate className="flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label="Card value" error={touched ? amountError ?? undefined : undefined}>
              <Input inputMode="decimal" autoFocus className="font-mono" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </FormField>
            <div className="flex flex-col gap-1.5">
              <Label asChild><span>Expiry</span></Label>
              <Select value={neverExpires ? 'never' : '12m'} onValueChange={(v) => setNeverExpires(v === 'never')}>
                <SelectTrigger className="w-full" aria-label="Expiry"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="12m">In 12 months</SelectItem>
                  <SelectItem value="never">Never expires</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <FormField label="Pre-printed card number (optional)" error={touched ? numberError ?? undefined : undefined} hint="Leave empty to create a new code.">
            <Input autoComplete="off" spellCheck={false} className="font-mono uppercase" value={cardNumber} onChange={(e) => setCardNumber(e.target.value)} />
          </FormField>
          {customer && (
            <div className="flex items-center gap-2">
              <Checkbox id="gift-card-customer" checked={linkCustomer} onCheckedChange={(v) => setLinkCustomer(v === true)} />
              <Label htmlFor="gift-card-customer">For {customer.name}</Label>
            </div>
          )}

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium">Paid with</legend>
            {rows.map((r, i) => (
              <div key={i} className="grid grid-cols-[9rem_1fr_auto] items-start gap-2">
                <Select value={r.method} onValueChange={(v) => setRow(i, { method: v as TillMoneyMethod })}>
                  <SelectTrigger className="w-full" aria-label={`Gift card payment ${i + 1} method`}><SelectValue /></SelectTrigger>
                  <SelectContent>{METHODS.map((m) => <SelectItem key={m} value={m}>{TILL_MONEY_METHODS[m]}</SelectItem>)}</SelectContent>
                </Select>
                <div className="flex flex-col gap-1">
                  {split ? (
                    <Input aria-label={`Gift card payment ${i + 1} amount`} inputMode="decimal" className="font-mono" value={r.amount} onChange={(e) => setRow(i, { amount: e.target.value })} />
                  ) : (
                    <p className="py-2 font-mono text-sm">{MONEY_PATTERN.test(amount.trim()) ? formatMoney(amount.trim(), till.currency) : '—'}</p>
                  )}
                  {r.method !== 'cash' && (
                    <Input aria-label={`Gift card payment ${i + 1} reference`} placeholder="Card / transaction reference" value={r.reference} onChange={(e) => setRow(i, { reference: e.target.value })} />
                  )}
                </div>
                <Button type="button" variant="ghost" size="icon" aria-label={`Remove gift card payment ${i + 1}`} disabled={rows.length === 1} onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}>
                  <Trash2Icon />
                </Button>
              </div>
            ))}
            <div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setRows((rs) => [...rs.map((r, j) => (j === 0 && rs.length === 1 ? { ...r, amount: amount.trim() } : r)), { method: 'card', amount: '', reference: '' }])}
              >
                <PlusIcon data-icon="inline-start" /> Split payment
              </Button>
            </div>
          </fieldset>

          {touched && error && error !== amountError && error !== numberError && <p role="alert" className="text-sm text-destructive">{error}</p>}
          {sell.error && <p role="alert" className="text-sm text-destructive">{sell.error.message}</p>}
        </form>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={close}>Cancel</Button>
          <Button type="submit" form="sell-gift-card-form" disabled={sell.isPending}>
            {sell.isPending && <Loader2Icon data-icon="inline-start" className="animate-spin" />}
            Sell gift card
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
