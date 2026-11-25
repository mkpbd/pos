import { useState, type FormEvent } from 'react'
import { Loader2Icon, XIcon } from 'lucide-react'
import { toast } from 'sonner'
import { FormField } from '@/components/common/form-field'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth, useCan } from '@/features/auth/use-auth'
import { GIFT_CARD_KINDS, useIssueVoucherMutation, type IssuedGiftCard, type VoucherInput } from '@/features/gift-cards/api'
import { isRetryable, useIdempotencyKey } from '@/features/returns/api'
import { CustomerSearch } from '@/features/web-orders/components/customer-search'
import { fieldErrorMap } from '@/lib/forms'
import { compareDecimal, formatMoney, isZeroDecimal, MONEY_PATTERN } from '@/lib/money'

/** Same bounds as a sold gift card. */
const MIN_AMOUNT = '10'
const MAX_AMOUNT = '1000000'

/** YYYY-MM-DD a year from today (local date). */
function inTwelveMonths(): string {
  const d = new Date()
  d.setFullYear(d.getFullYear() + 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

type Props = { open: boolean; onOpenChange: (open: boolean) => void; onIssued: (issued: IssuedGiftCard) => void }

/** Mounted inside DialogContent, so each opening starts with an empty form. */
function VoucherForm({ onOpenChange, onIssued, issue }: Omit<Props, 'open'> & { issue: ReturnType<typeof useIssueVoucherMutation> }) {
  const me = useAuth()
  const can = useCan()
  const currency = me.organization?.base_currency
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [customer, setCustomer] = useState<{ id: string; name: string } | null>(null)
  const [expiresAt, setExpiresAt] = useState(inTwelveMonths)
  const [neverExpires, setNeverExpires] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const idempotency = useIdempotencyKey()

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    const value = amount.trim()
    const local: Record<string, string> = {}
    if (!MONEY_PATTERN.test(value) || isZeroDecimal(value)) local.amount = 'An amount with up to 2 decimals.'
    else if (compareDecimal(value, MIN_AMOUNT) < 0 || compareDecimal(value, MAX_AMOUNT) > 0) local.amount = `Between ${formatMoney(MIN_AMOUNT, currency)} and ${formatMoney(MAX_AMOUNT, currency)}.`
    if (!reason.trim()) local.reason = 'Say why the voucher is given.'
    if (!neverExpires && !expiresAt) local.expires_at = 'Choose an expiry date or tick “No expiry”.'
    setErrors(local)
    if (Object.keys(local).length > 0) return

    const input: VoucherInput = {
      amount: value,
      reason: reason.trim(),
      ...(customer ? { customer_id: customer.id } : {}),
      ...(neverExpires ? { expires_at: null, never_expires: true } : { expires_at: expiresAt }),
    }
    issue.mutate({ input, idempotencyKey: idempotency.keyFor(input) }, {
      onSuccess: (issued) => {
        idempotency.settle()
        onOpenChange(false)
        onIssued(issued)
      },
      onError: (error) => {
        idempotency.settle(error)
        setErrors(fieldErrorMap(error))
        if (isRetryable(error)) toast.message('You can press “Issue voucher” again to retry safely.')
      },
    })
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Issue voucher</DialogTitle>
        <DialogDescription>A {GIFT_CARD_KINDS.voucher.toLowerCase()} is spent at the till like a gift card; no money is taken for it.</DialogDescription>
      </DialogHeader>
      <form id="voucher-form" onSubmit={onSubmit} noValidate className="grid gap-4 sm:grid-cols-2">
        <FormField label={`Amount${currency ? ` (${currency})` : ''}`} error={errors.amount}>
          <Input inputMode="decimal" className="font-mono" autoFocus value={amount} onChange={(e) => setAmount(e.target.value)} />
        </FormField>
        <FormField label="Valid until" error={errors.expires_at}>
          <Input type="date" value={neverExpires ? '' : expiresAt} disabled={neverExpires} onChange={(e) => setExpiresAt(e.target.value)} />
        </FormField>
        <div className="flex items-center gap-2 sm:col-span-2">
          <Checkbox id="voucher-never-expires" checked={neverExpires} onCheckedChange={(v) => setNeverExpires(v === true)} />
          <Label htmlFor="voucher-never-expires" className="font-normal">No expiry</Label>
        </div>
        <FormField label="Reason" error={errors.reason} className="sm:col-span-2">
          <Input maxLength={200} placeholder="e.g. apology for a damaged delivery" value={reason} onChange={(e) => setReason(e.target.value)} />
        </FormField>
        {can('customers.view') && (
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <span className="text-sm font-medium">Customer (optional)</span>
            {customer ? (
              <div className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
                <span data-testid="voucher-customer">{customer.name}</span>
                <Button type="button" variant="ghost" size="icon-sm" aria-label="Remove customer" onClick={() => setCustomer(null)}><XIcon /></Button>
              </div>
            ) : (
              <CustomerSearch onSelect={(c) => setCustomer({ id: c.id, name: c.name })} />
            )}
            {errors.customer_id && <p className="text-sm text-destructive">{errors.customer_id}</p>}
          </div>
        )}
        {errors.form && <p role="alert" className="text-sm text-destructive sm:col-span-2">{errors.form}</p>}
      </form>
      <DialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)} disabled={issue.isPending}>Cancel</Button>
        <Button type="submit" form="voucher-form" disabled={issue.isPending}>
          {issue.isPending && <Loader2Icon data-icon="inline-start" className="animate-spin" />}
          Issue voucher
        </Button>
      </DialogFooter>
    </>
  )
}

/** gift_cards.manage: a voucher with no money taken; the full code is handed to `onIssued` (shown once). */
export function IssueVoucherDialog({ open, onOpenChange, onIssued }: Props) {
  const issue = useIssueVoucherMutation()
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!issue.isPending) onOpenChange(o) }}>
      <DialogContent>
        {open && <VoucherForm onOpenChange={onOpenChange} onIssued={onIssued} issue={issue} />}
      </DialogContent>
    </Dialog>
  )
}
