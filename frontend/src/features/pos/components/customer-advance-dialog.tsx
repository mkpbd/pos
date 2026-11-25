import { useCallback, useRef, useState } from 'react'
import { Loader2Icon, PrinterIcon } from 'lucide-react'
import { FormField } from '@/components/common/form-field'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { CustomerRef } from '@/features/pos/cart-store'
import type { TillContext } from '@/features/pos/components/sell-gift-card-dialog'
import { SlipPrinter, StoredValueSlip, type SlipData } from '@/features/pos/components/stored-value-slip'
import { TILL_MONEY_METHODS, tillReceiptFormat, useTopUpMutation, type TillMoneyMethod, type TopUpInput, type TopUpResult } from '@/features/pos/stored-value-api'
import { compareDecimal, formatMoney, MONEY_PATTERN } from '@/lib/money'

const MAX_ADVANCE = '10000000'
const METHODS = Object.keys(TILL_MONEY_METHODS) as TillMoneyMethod[]

function amountProblem(value: string): string | null {
  const v = value.trim()
  if (v === '') return 'Enter the amount.'
  if (!MONEY_PATTERN.test(v)) return 'An amount with up to 2 decimals.'
  if (compareDecimal(v, '0') <= 0) return 'The amount must be more than zero.'
  if (compareDecimal(v, MAX_ADVANCE) > 0) return `At most ${formatMoney(MAX_ADVANCE)}.`
  return null
}

/**
 * POS1b: the customer pays money in advance; it becomes store credit they spend at the till later.
 * The money comes in like a customer payment (cash into the open drawer).
 */
export function CustomerAdvanceDialog({
  till,
  customer,
  balance,
  onClose,
}: {
  till: TillContext
  customer: CustomerRef
  /** Current store credit, when this user may see it. */
  balance: string | null
  onClose: () => void
}) {
  const topUp = useTopUpMutation(customer.id)
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState<TillMoneyMethod>('cash')
  const [reference, setReference] = useState('')
  const [note, setNote] = useState('')
  const [touched, setTouched] = useState(false)
  const [done, setDone] = useState<{ result: TopUpResult; input: TopUpInput; at: string } | null>(null)
  const [printing, setPrinting] = useState(false)
  const donePrinting = useCallback(() => setPrinting(false), [])
  const pending = useRef<{ fingerprint: string; key: string } | null>(null)

  const amountError = amountProblem(amount)
  const error =
    amountError
    ?? (note.trim().length > 200 ? 'The note can be at most 200 characters.' : null)
    ?? (method === 'cash' && !till.cashReady ? 'Cash needs an open register session; open one first or take card / mobile.' : null)
    ?? (till.storeId ? null : 'Choose the store you sell from first.')

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    setTouched(true)
    if (error || topUp.isPending || !till.storeId) return
    const input: TopUpInput = {
      store_id: till.storeId,
      amount: amount.trim(),
      method,
      reference: method === 'cash' ? null : reference.trim() || null,
      note: note.trim() || null,
    }
    const fingerprint = JSON.stringify(input)
    const key = pending.current?.fingerprint === fingerprint ? pending.current.key : crypto.randomUUID()
    pending.current = { fingerprint, key }
    topUp.mutate({ input, idempotencyKey: key }, {
      onSuccess: (result) => { pending.current = null; setDone({ result, input, at: result.entry?.created_at ?? new Date().toISOString() }) },
    })
  }

  const close = () => { if (!topUp.isPending) onClose() }

  if (done) {
    const slip: SlipData = {
      organization: till.organization,
      branch: till.branch,
      title: 'Customer advance',
      number: done.result.receipt_number,
      at: done.at,
      cashier: till.cashier,
      rows: [
        { label: 'Customer', value: `${customer.name} (${customer.code})` },
        { label: 'Advance', value: formatMoney(done.input.amount, till.currency), bold: true },
        { label: `${TILL_MONEY_METHODS[done.input.method]}${done.input.reference ? ` (${done.input.reference})` : ''}`, value: formatMoney(done.input.amount) },
        { label: 'Store credit balance', value: formatMoney(done.result.balance, till.currency), bold: true },
      ],
      footer: 'Spend your store credit on your next purchase.',
    }
    const format = tillReceiptFormat()
    return (
      <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
        <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Advance received</DialogTitle>
            <DialogDescription>
              {done.result.receipt_number} · {customer.name} now has <b className="font-mono">{formatMoney(done.result.balance, till.currency)}</b> of store credit.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-center overflow-x-auto rounded-md border bg-muted/40 p-3">
            <div className="shadow-sm"><StoredValueSlip slip={slip} format={format} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={printing} onClick={() => setPrinting(true)}>
              <PrinterIcon data-icon="inline-start" /> Print
            </Button>
            <Button autoFocus onClick={onClose}>Done</Button>
          </DialogFooter>
          {printing && <SlipPrinter slip={slip} format={format} onDone={donePrinting} />}
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) close() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Customer advance</DialogTitle>
          <DialogDescription>
            {customer.name} pays now and spends it later as store credit.
            {balance !== null && <> Current store credit: <span className="font-mono">{formatMoney(balance, till.currency)}</span>.</>}
          </DialogDescription>
        </DialogHeader>
        <form id="customer-advance-form" onSubmit={submit} noValidate className="flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label="Amount" error={touched ? amountError ?? undefined : undefined}>
              <Input inputMode="decimal" autoFocus className="font-mono" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </FormField>
            <div className="flex flex-col gap-1.5">
              <Label asChild><span>Paid with</span></Label>
              <Select value={method} onValueChange={(v) => setMethod(v as TillMoneyMethod)}>
                <SelectTrigger className="w-full" aria-label="Paid with"><SelectValue /></SelectTrigger>
                <SelectContent>{METHODS.map((m) => <SelectItem key={m} value={m}>{TILL_MONEY_METHODS[m]}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          {method !== 'cash' && (
            <FormField label="Reference (optional)">
              <Input placeholder="Card / transaction reference" value={reference} onChange={(e) => setReference(e.target.value)} />
            </FormField>
          )}
          <FormField label="Note (optional)">
            <Input maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
          </FormField>
          {touched && error && error !== amountError && <p role="alert" className="text-sm text-destructive">{error}</p>}
          {topUp.error && <p role="alert" className="text-sm text-destructive">{topUp.error.message}</p>}
        </form>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={close}>Cancel</Button>
          <Button type="submit" form="customer-advance-form" disabled={topUp.isPending}>
            {topUp.isPending && <Loader2Icon data-icon="inline-start" className="animate-spin" />}
            Take advance
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
