import { useState } from 'react'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Link } from 'react-router'
import { AlertTriangleIcon, Loader2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { z } from 'zod'
import { FormField } from '@/components/common/form-field'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useAuth } from '@/features/auth/use-auth'
import { useReceiveCustomerPaymentMutation } from '@/features/customers/api'
import { isRetryable, useIdempotencyKey } from '@/features/returns/api'
import { useCustomerBalancesQuery } from '@/features/sales/api'
import { ApiError } from '@/lib/api/client'
import { handleFormError } from '@/lib/forms'
import { compareDecimal, formatMoney, MONEY_PATTERN } from '@/lib/money'
import { MONEY_METHODS, type MoneyMethod } from '@/lib/payment-methods'
import { useSessionStore } from '@/stores/session-store'

const METHODS = Object.keys(MONEY_METHODS) as MoneyMethod[]
const FIELDS = ['amount', 'method', 'reference', 'notes'] as const

const schema = z.object({
  amount: z.string().trim().regex(MONEY_PATTERN, 'Amount with up to 2 decimals.').refine((v) => !/^0+(\.0+)?$/.test(v), 'Must be greater than zero.'),
  method: z.enum(METHODS as [MoneyMethod, ...MoneyMethod[]]),
  reference: z.string().max(100),
  notes: z.string().max(1000),
})
type Values = z.infer<typeof schema>

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  customer: { id: string; code: string; name: string } | null
}

/** Mounted inside DialogContent, so each opening starts with an empty form. */
function ReceivePaymentForm({ onOpenChange, customer, receive }: Omit<Props, 'open'> & { receive: ReturnType<typeof useReceiveCustomerPaymentMutation> }) {
  const me = useAuth()
  const currency = me.organization?.base_currency
  const branchId = useSessionStore((s) => s.activeBranchId)
  const branch = me.branches.find((b) => b.id === branchId)
  const balances = useCustomerBalancesQuery(customer ? [customer.id] : [], !!customer)
  const balance = customer ? balances.data?.[customer.id] : undefined
  const owes = balance !== undefined && compareDecimal(balance.replace(/^-/, ''), '0') > 0 && !balance.startsWith('-')
  const [blocker, setBlocker] = useState<{ code: string; message: string } | null>(null)
  // One Idempotency-Key per logical payment, reused when the same payload is retried.
  const idempotency = useIdempotencyKey()

  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { amount: '', method: 'cash', reference: '', notes: '' } })
  const { errors } = form.formState
  const method = useWatch({ control: form.control, name: 'method' })

  const onSubmit = form.handleSubmit((v) => {
    if (!customer || !branchId) return
    if (balance !== undefined && compareDecimal(v.amount, balance.startsWith('-') ? '0' : balance) > 0) {
      form.setError('amount', { type: 'max', message: `At most the balance owed (${formatMoney(balance, currency)}).` })
      return
    }
    setBlocker(null)
    const input = { customer_id: customer.id, branch_id: branchId, amount: v.amount.trim(), method: v.method, reference: v.reference.trim() || null, notes: v.notes.trim() || null }
    receive.mutate({ input, idempotencyKey: idempotency.keyFor(input) }, {
      onSuccess: (p) => {
        idempotency.settle()
        toast.success(`${p.number}: ${formatMoney(p.amount, p.currency)} received from ${customer.name}.`)
        onOpenChange(false)
      },
      onError: (error) => {
        idempotency.settle(error)
        if (error instanceof ApiError && error.code === 'PAYMENT_EXCEEDS_BALANCE') {
          const outstanding = typeof error.details.outstanding === 'string' ? error.details.outstanding : null
          form.setError('amount', { type: 'server', message: outstanding ? `At most the balance owed (${formatMoney(outstanding, currency)}).` : error.message })
          void balances.refetch()
          return
        }
        if (error instanceof ApiError && (error.code === 'CASH_SESSION_REQUIRED' || error.code === 'INSUFFICIENT_CASH')) {
          setBlocker({ code: error.code, message: error.message })
          return
        }
        handleFormError(error, form.setError, FIELDS)
        if (isRetryable(error)) toast.message('You can press “Receive payment” again to retry safely.')
      },
    })
  })

  return (
    <>
      <DialogHeader>
        <DialogTitle>Receive payment</DialogTitle>
        <DialogDescription>
          {customer ? <>{customer.name} <span className="font-mono text-xs">{customer.code}</span></> : 'Customer payment'}
          {branch && ` · into ${branch.name}`}
        </DialogDescription>
      </DialogHeader>

      <div className="flex items-center justify-between rounded-md border p-3">
        <span className="text-sm text-muted-foreground">Balance owed</span>
        <span className="font-mono text-lg font-semibold" data-testid="balance-owed">
          {balances.isPending ? '…' : balance !== undefined ? formatMoney(balance, currency) : '—'}
        </span>
      </div>
      {balances.error && <p className="text-sm text-muted-foreground">The current balance could not be loaded; the server still checks the amount.</p>}
      {balance !== undefined && !owes && <p className="text-sm text-muted-foreground">{customer?.name} owes nothing at the moment.</p>}
      {!branchId && <p role="alert" className="text-sm text-destructive">Choose a branch in the header first; payments are booked to a branch.</p>}

      <form id="receive-payment-form" onSubmit={onSubmit} noValidate className="grid gap-4 sm:grid-cols-2">
        <FormField label={`Amount (${currency ?? ''})`} error={errors.amount?.message}>
          <Input inputMode="decimal" className="font-mono" autoFocus {...form.register('amount')} />
        </FormField>
        <FormField label="Method" error={errors.method?.message}>
          <Controller control={form.control} name="method" render={({ field }) => (
            <Select value={field.value} onValueChange={(v) => { field.onChange(v); setBlocker(null) }}>
              <SelectTrigger className="w-full" aria-label="Payment method"><SelectValue /></SelectTrigger>
              <SelectContent>{METHODS.map((m) => <SelectItem key={m} value={m}>{MONEY_METHODS[m]}</SelectItem>)}</SelectContent>
            </Select>
          )} />
        </FormField>
        {owes && (
          <Button type="button" variant="link" size="sm" className="-mt-2 justify-self-start px-0 sm:col-span-2" onClick={() => form.setValue('amount', balance, { shouldValidate: true })}>
            Pay full balance ({formatMoney(balance, currency)})
          </Button>
        )}
        {method === 'cash' && (
          <p className="text-sm text-muted-foreground sm:col-span-2">Cash goes into your open register session{branch ? ` in ${branch.name}` : ''}.</p>
        )}
        <FormField label="Reference" error={errors.reference?.message} className="sm:col-span-2">
          <Input placeholder="Cheque / transaction no." {...form.register('reference')} />
        </FormField>
        <FormField label="Notes" error={errors.notes?.message} className="sm:col-span-2">
          <Textarea rows={2} {...form.register('notes')} />
        </FormField>
      </form>

      {blocker && (
        <div role="alert" className="flex gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
          <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
          <div className="flex flex-col gap-1">
            <span>{blocker.message}</span>
            {blocker.code === 'CASH_SESSION_REQUIRED' && (
              <span className="text-muted-foreground">
                Open a register session at the <Link to="/pos" className="underline">POS terminal</Link> or on <Link to="/cash-registers" className="underline">Cash registers</Link>, or take the payment by another method.
              </span>
            )}
          </div>
        </div>
      )}

      <DialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)} disabled={receive.isPending}>Cancel</Button>
        <Button type="submit" form="receive-payment-form" disabled={receive.isPending || !branchId || !customer || (balance !== undefined && !owes)}>
          {receive.isPending && <Loader2Icon data-icon="inline-start" className="animate-spin" />}
          Receive payment
        </Button>
      </DialogFooter>
    </>
  )
}

/**
 * Records money a customer pays against what they owe (accounts receivable). Paid into the
 * active branch; cash goes into the cashier's open register session there.
 */
export function ReceivePaymentDialog({ open, onOpenChange, customer }: Props) {
  const receive = useReceiveCustomerPaymentMutation()
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!receive.isPending) onOpenChange(o) }}>
      <DialogContent>
        <ReceivePaymentForm onOpenChange={onOpenChange} customer={customer} receive={receive} />
      </DialogContent>
    </Dialog>
  )
}
