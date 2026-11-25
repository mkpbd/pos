import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { AlertTriangleIcon, Loader2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { FormField } from '@/components/common/form-field'
import { StoreSelect } from '@/components/common/store-select'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useBranchesQuery } from '@/features/branches/api'
import { isRetryable, useIdempotencyKey } from '@/features/returns/api'
import {
  STORE_CREDIT_METHODS,
  useStoreCreditChangeMutation,
  type StoreCreditAction,
  type StoreCreditMethod,
} from '@/features/customers/store-credit-api'
import { ApiError } from '@/lib/api/client'
import { fieldErrorMap } from '@/lib/forms'
import { compareDecimal, formatMoney, isZeroDecimal, MONEY_PATTERN } from '@/lib/money'
import { useSessionStore } from '@/stores/session-store'

const METHODS = Object.keys(STORE_CREDIT_METHODS) as StoreCreditMethod[]
/** The server's ceiling for one advance / pay-out. */
const MAX_AMOUNT = '10000000'
const SIGNED_MONEY = /^-?\d{1,16}(\.\d{1,2})?$/

const TITLES: Record<StoreCreditAction, string> = { top_up: 'Add advance', withdrawal: 'Pay out store credit', adjustment: 'Adjust store credit' }
const SUBMIT: Record<StoreCreditAction, string> = { top_up: 'Add advance', withdrawal: 'Pay out', adjustment: 'Adjust' }

type Props = {
  action: StoreCreditAction | null
  onOpenChange: (open: boolean) => void
  customer: { id: string; name: string }
  /** The current balance (null while loading); the server still checks it. */
  balance: string | null
  currency?: string
}

/** The first active store of the branch chosen in the header, as a starting point. */
function useDefaultStoreId(): string | null {
  const branchId = useSessionStore((s) => s.activeBranchId)
  const branches = useBranchesQuery({ page: 1, per_page: 100, is_active: true })
  const branch = branches.data?.items.find((b) => b.id === branchId)
  return branch?.stores.find((s) => s.is_active)?.id ?? null
}

/** Mounted inside DialogContent, so each opening starts with an empty form. */
function StoreCreditForm({ action, onOpenChange, customer, balance, currency, change }: Omit<Props, 'action'> & { action: StoreCreditAction; change: ReturnType<typeof useStoreCreditChangeMutation> }) {
  const defaultStoreId = useDefaultStoreId()
  const [storeId, setStoreId] = useState<string | null>(null)
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState<StoreCreditMethod>('cash')
  const [reference, setReference] = useState('')
  const [note, setNote] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [blocker, setBlocker] = useState<{ code: string; message: string } | null>(null)
  const idempotency = useIdempotencyKey()
  const money = action !== 'adjustment'
  const store = storeId ?? defaultStoreId

  const validate = (): Record<string, string> => {
    const next: Record<string, string> = {}
    const value = amount.trim()
    if (money) {
      if (!store) next.store_id = 'Choose the store the money goes through.'
      if (!MONEY_PATTERN.test(value) || isZeroDecimal(value)) next.amount = 'An amount greater than zero with up to 2 decimals.'
      else if (compareDecimal(value, MAX_AMOUNT) > 0) next.amount = `At most ${formatMoney(MAX_AMOUNT, currency)}.`
      else if (action === 'withdrawal' && balance !== null && compareDecimal(value, balance) > 0) next.amount = `At most the balance (${formatMoney(balance, currency)}).`
    } else {
      if (!SIGNED_MONEY.test(value) || isZeroDecimal(value)) next.amount = 'A non-zero amount with up to 2 decimals; negative to deduct.'
      else if (value.startsWith('-') && balance !== null && compareDecimal(value.slice(1), balance) > 0) next.amount = `The balance cannot go below zero (it is ${formatMoney(balance, currency)}).`
      if (!note.trim()) next.reason = 'Say why.'
    }
    return next
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    const local = validate()
    setErrors(local)
    if (Object.keys(local).length > 0) return
    setBlocker(null)
    const input = money
      ? { store_id: store as string, amount: amount.trim(), method, ...(reference.trim() ? { reference: reference.trim() } : {}), ...(note.trim() ? { note: note.trim() } : {}) }
      : { amount: amount.trim(), reason: note.trim() }
    change.mutate({ customerId: customer.id, action, input, idempotencyKey: idempotency.keyFor({ action, input }) }, {
      onSuccess: (r) => {
        idempotency.settle()
        const number = r.receipt_number ?? r.entry.receipt_number
        const what = action === 'top_up' ? 'added to' : action === 'withdrawal' ? 'paid out of' : 'adjusted on'
        toast.success(`${number ? `${number}: ` : ''}${formatMoney(r.entry.amount.replace(/^-/, ''), currency)} ${what} ${customer.name}'s store credit. Balance ${formatMoney(r.balance, currency)}.`)
        onOpenChange(false)
      },
      onError: (error) => {
        idempotency.settle(error)
        if (error instanceof ApiError && error.code === 'INSUFFICIENT_STORE_CREDIT') {
          const left = typeof error.details.balance === 'string' ? error.details.balance : null
          setErrors({ amount: left ? `The balance is only ${formatMoney(left, currency)}.` : error.message })
          return
        }
        if (error instanceof ApiError && (error.code === 'CASH_SESSION_REQUIRED' || error.code === 'INSUFFICIENT_CASH')) {
          setBlocker({ code: error.code, message: error.message })
          return
        }
        setErrors(fieldErrorMap(error))
        if (isRetryable(error)) toast.message(`You can press “${SUBMIT[action]}” again to retry safely.`)
      },
    })
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{TITLES[action]}</DialogTitle>
        <DialogDescription>
          {customer.name}
          {balance !== null && <> · balance <span className="font-mono">{formatMoney(balance, currency)}</span></>}
        </DialogDescription>
      </DialogHeader>
      <form id="store-credit-form" onSubmit={onSubmit} noValidate className="grid gap-4 sm:grid-cols-2">
        {money ? (
          <>
            {/* Remounted once the default store is known, so the Select never switches from uncontrolled to controlled. */}
            <FormField label="Store" error={errors.store_id} className="sm:col-span-2">
              <StoreSelect key={store ? 'chosen' : 'none'} value={store} onChange={(id) => { setStoreId(id); setBlocker(null) }} aria-label="Store" invalid={!!errors.store_id} />
            </FormField>
            <FormField label={`Amount${currency ? ` (${currency})` : ''}`} error={errors.amount}>
              <Input inputMode="decimal" className="font-mono" autoFocus value={amount} onChange={(e) => setAmount(e.target.value)} />
            </FormField>
            <FormField label="Method" error={errors.method}>
              <Select value={method} onValueChange={(v) => { setMethod(v as StoreCreditMethod); setBlocker(null) }}>
                <SelectTrigger className="w-full" aria-label="Method"><SelectValue /></SelectTrigger>
                <SelectContent>{METHODS.map((m) => <SelectItem key={m} value={m}>{STORE_CREDIT_METHODS[m]}</SelectItem>)}</SelectContent>
              </Select>
            </FormField>
            {method === 'cash' && (
              <p className="text-sm text-muted-foreground sm:col-span-2">
                {action === 'top_up' ? 'Cash goes into your open register session in that store’s branch.' : 'Cash is paid out of your open register session in that store’s branch.'}
              </p>
            )}
            {method !== 'cash' && (
              <FormField label="Reference" error={errors.reference} className="sm:col-span-2">
                <Input maxLength={100} placeholder="Card slip / transaction no." value={reference} onChange={(e) => setReference(e.target.value)} />
              </FormField>
            )}
            <FormField label="Note" error={errors.note} className="sm:col-span-2">
              <Input maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
            </FormField>
          </>
        ) : (
          <>
            <FormField label={`Amount (±${currency ? ` ${currency}` : ''})`} error={errors.amount} hint="Negative to deduct.">
              <Input inputMode="decimal" className="font-mono" autoFocus placeholder="e.g. 100 or -50" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </FormField>
            <FormField label="Reason" error={errors.reason}>
              <Input maxLength={200} placeholder="e.g. goodwill for a late delivery" value={note} onChange={(e) => setNote(e.target.value)} />
            </FormField>
          </>
        )}
        {errors.form && <p role="alert" className="text-sm text-destructive sm:col-span-2">{errors.form}</p>}
      </form>

      {blocker && (
        <div role="alert" className="flex gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
          <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
          <div className="flex flex-col gap-1">
            <span>{blocker.message}</span>
            {blocker.code === 'CASH_SESSION_REQUIRED' && (
              <span className="text-muted-foreground">
                Open a register session at the <Link to="/pos" className="underline">POS terminal</Link> or on <Link to="/cash-registers" className="underline">Cash registers</Link>, or use another method.
              </span>
            )}
          </div>
        </div>
      )}

      <DialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)} disabled={change.isPending}>Cancel</Button>
        <Button type="submit" form="store-credit-form" disabled={change.isPending}>
          {change.isPending && <Loader2Icon data-icon="inline-start" className="animate-spin" />}
          {SUBMIT[action]}
        </Button>
      </DialogFooter>
    </>
  )
}

/** Add an advance (money in), pay store credit out (money out) or adjust it (no money). */
export function StoreCreditDialog({ action, onOpenChange, ...props }: Props) {
  const change = useStoreCreditChangeMutation()
  return (
    <Dialog open={action !== null} onOpenChange={(o) => { if (!change.isPending) onOpenChange(o) }}>
      <DialogContent>
        {action && <StoreCreditForm action={action} onOpenChange={onOpenChange} change={change} {...props} />}
      </DialogContent>
    </Dialog>
  )
}
