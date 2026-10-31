import { useRef, useState } from 'react'
import { Loader2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { FormField } from '@/components/common/form-field'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { isRetryable } from '@/features/returns/api'
import {
  useCashMovementMutation,
  useCashRegistersQuery,
  useCloseSessionMutation,
  useOpenSessionMutation,
  varianceTone,
  type RegisterSession,
  type SessionReport,
} from '@/features/registers/api'
import type { PaymentDirection } from '@/features/payments/api'
import { formatMoney, isZeroDecimal, MONEY_PATTERN, subtractDecimal } from '@/lib/money'

// Each dialog's form lives in a component inside DialogContent, which unmounts when the
// dialog closes — so every opening starts with a fresh form.

const validMoney = (v: string) => MONEY_PATTERN.test(v.trim())

type OpenProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  branchId: string | undefined
  /** Preselects (and locks) a register, e.g. when opened from the registers list. */
  registerId?: string
  onOpened?: (report: SessionReport) => void
}

function OpenSessionForm({ onOpenChange, branchId, registerId, onOpened, openSession }: Omit<OpenProps, 'open'> & { openSession: ReturnType<typeof useOpenSessionMutation> }) {
  const registers = useCashRegistersQuery({ branch_id: branchId }, { enabled: !!branchId })
  const free = (registers.data ?? []).filter((r) => r.is_active && (r.open_session === null || r.id === registerId))
  const [selected, setSelected] = useState(registerId ?? '')
  const [float, setFloat] = useState('')
  const [error, setError] = useState<string | null>(null)

  // A single free register needs no choice.
  const chosen = selected || (free.length === 1 ? free[0]?.id : undefined) || ''

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!chosen) return setError('Choose a register.')
    if (!validMoney(float)) return setError('Count the cash in the drawer: an amount with up to 2 decimals (0 for an empty drawer).')
    setError(null)
    openSession.mutate({ registerId: chosen, openingFloat: float.trim() }, {
      onSuccess: (report) => {
        toast.success(`${report.number} opened on ${report.register?.name ?? 'the register'}.`)
        onOpenChange(false)
        onOpened?.(report)
      },
      onError: (err) => setError(err.message),
    })
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Open register session</DialogTitle>
        <DialogDescription>Count the cash in the drawer before the first sale. Every cash payment of your shift is booked to this session.</DialogDescription>
      </DialogHeader>
      <form id="open-session-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
        <FormField label="Register">
          <Select value={chosen} onValueChange={setSelected} disabled={!!registerId || registers.isPending}>
            <SelectTrigger className="w-full" aria-label="Register">
              <SelectValue placeholder={registers.isPending ? 'Loading registers…' : free.length === 0 ? 'No free register in this branch' : 'Choose a register'} />
            </SelectTrigger>
            <SelectContent>
              {free.map((r) => <SelectItem key={r.id} value={r.id}>{r.name} ({r.code})</SelectItem>)}
            </SelectContent>
          </Select>
        </FormField>
        <FormField label="Opening float (cash counted)">
          <Input inputMode="decimal" className="font-mono" autoFocus value={float} onChange={(e) => setFloat(e.target.value)} placeholder="0.00" />
        </FormField>
        {!registers.isPending && free.length === 0 && (
          <p className="text-sm text-muted-foreground">Every active register of this branch is in use. A manager can add one on the Cash registers page.</p>
        )}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      </form>
      <DialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)} disabled={openSession.isPending}>Cancel</Button>
        <Button type="submit" form="open-session-form" disabled={openSession.isPending || free.length === 0}>
          {openSession.isPending && <Loader2Icon data-icon="inline-start" className="animate-spin" />}
          Open session
        </Button>
      </DialogFooter>
    </>
  )
}

/** Opens a shift on one of the branch's free, active registers with a counted opening float. */
export function OpenSessionDialog({ open, onOpenChange, ...rest }: OpenProps) {
  const openSession = useOpenSessionMutation()
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!openSession.isPending) onOpenChange(o) }}>
      <DialogContent>
        <OpenSessionForm onOpenChange={onOpenChange} openSession={openSession} {...rest} />
      </DialogContent>
    </Dialog>
  )
}

type MovementProps = { onOpenChange: (open: boolean) => void; session: SessionReport; direction: PaymentDirection }

function CashMovementForm({ onOpenChange, session, direction, move }: MovementProps & { move: ReturnType<typeof useCashMovementMutation> }) {
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  // One Idempotency-Key per logical movement, kept while the same movement is retried.
  const pending = useRef<{ fingerprint: string; key: string } | null>(null)

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!validMoney(amount) || isZeroDecimal(amount)) return setError('Enter an amount greater than zero with up to 2 decimals.')
    if (!reason.trim()) return setError('Give a reason, e.g. “bank deposit”.')
    setError(null)
    const input = { direction, amount: amount.trim(), reason: reason.trim() }
    const fingerprint = JSON.stringify(input)
    if (pending.current?.fingerprint !== fingerprint) pending.current = { fingerprint, key: crypto.randomUUID() }

    move.mutate({ sessionId: session.id, input, idempotencyKey: pending.current.key }, {
      onSuccess: () => {
        pending.current = null
        toast.success(`${direction === 'in' ? 'Cash in' : 'Cash out'} of ${formatMoney(input.amount, session.currency)} recorded.`)
        onOpenChange(false)
      },
      onError: (err) => {
        if (!isRetryable(err)) pending.current = null
        setError(isRetryable(err) ? `${err.message} Press the button again to retry safely.` : err.message)
      },
    })
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{direction === 'in' ? 'Cash in' : 'Cash out'}</DialogTitle>
        <DialogDescription>
          {session.number} · expected in the drawer now <span className="font-mono">{formatMoney(session.cash.expected, session.currency)}</span>
        </DialogDescription>
      </DialogHeader>
      <form id="cash-movement-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
        <FormField label="Amount">
          <Input inputMode="decimal" className="font-mono" autoFocus value={amount} onChange={(e) => setAmount(e.target.value)} />
        </FormField>
        <FormField label="Reason">
          <Input maxLength={255} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={direction === 'in' ? 'e.g. float top-up' : 'e.g. bank deposit'} />
        </FormField>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      </form>
      <DialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)} disabled={move.isPending}>Cancel</Button>
        <Button type="submit" form="cash-movement-form" disabled={move.isPending}>
          {move.isPending && <Loader2Icon data-icon="inline-start" className="animate-spin" />}
          {direction === 'in' ? 'Record cash in' : 'Record cash out'}
        </Button>
      </DialogFooter>
    </>
  )
}

/** Cash put into or taken out of the drawer outside a sale (float top-up, bank drop, petty cash). */
export function CashMovementDialog({ open, ...rest }: MovementProps & { open: boolean }) {
  const move = useCashMovementMutation()
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!move.isPending) rest.onOpenChange(o) }}>
      <DialogContent>
        <CashMovementForm move={move} {...rest} />
      </DialogContent>
    </Dialog>
  )
}

type CloseProps = {
  onOpenChange: (open: boolean) => void
  session: RegisterSession & { cash?: SessionReport['cash'] }
  onClosed?: (report: SessionReport) => void
}

function CloseSessionForm({ onOpenChange, session, onClosed, close }: CloseProps & { close: ReturnType<typeof useCloseSessionMutation> }) {
  const [counted, setCounted] = useState('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)
  const expected = session.cash?.expected ?? null
  const preview = expected !== null && validMoney(counted) ? subtractDecimal(counted.trim(), expected, 2) : null
  const tone = varianceTone(preview)

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!validMoney(counted)) return setError('Enter the cash counted, with up to 2 decimals.')
    setError(null)
    close.mutate({ sessionId: session.id, countedCash: counted.trim(), notes: notes.trim() || null }, {
      onSuccess: (report) => {
        toast.success(`${report.number} closed.`)
        onOpenChange(false)
        onClosed?.(report)
      },
      onError: (err) => setError(err.message),
    })
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Close {session.number}</DialogTitle>
        <DialogDescription>
          Count the cash in the drawer. {expected !== null && <>Expected: <span className="font-mono">{formatMoney(expected, session.currency)}</span>.</>}
        </DialogDescription>
      </DialogHeader>
      <form id="close-session-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
        <FormField label="Cash counted">
          <Input inputMode="decimal" className="font-mono" autoFocus value={counted} onChange={(e) => setCounted(e.target.value)} />
        </FormField>
        {preview !== null && tone && (
          <p className="text-sm" data-testid="variance-preview">
            Variance <span className="font-mono">{formatMoney(preview, session.currency)}</span> · {tone.label}
          </p>
        )}
        <FormField label="Notes">
          <Textarea rows={2} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional, e.g. why the drawer is short" />
        </FormField>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      </form>
      <DialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)} disabled={close.isPending}>Cancel</Button>
        <Button type="submit" form="close-session-form" disabled={close.isPending}>
          {close.isPending && <Loader2Icon data-icon="inline-start" className="animate-spin" />}
          Close session
        </Button>
      </DialogFooter>
    </>
  )
}

/** End of shift: the cashier counts the drawer; the server freezes expected cash and the variance (Z report). */
export function CloseSessionDialog({ open, ...rest }: CloseProps & { open: boolean }) {
  const close = useCloseSessionMutation()
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!close.isPending) rest.onOpenChange(o) }}>
      <DialogContent>
        <CloseSessionForm close={close} {...rest} />
      </DialogContent>
    </Dialog>
  )
}
