import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { BanIcon, Loader2Icon, ShieldCheckIcon } from 'lucide-react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { FormField } from '@/components/common/form-field'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { useCan } from '@/features/auth/use-auth'
import { formatDateTime } from '@/features/web-orders/orders'
import {
  findBlockedPhone,
  RISK_DOT,
  RISK_TONE_LABEL,
  rateLabel,
  riskTone,
  useBlockPhoneMutation,
  useUnblockPhoneMutation,
  type PhoneReport,
} from '@/features/web-orders/risk'
import { fieldErrorMap } from '@/lib/forms'
import { cn } from '@/lib/utils'

/** A plain coloured dot with the rate; the colour is also said in words for screen readers. */
export function SuccessRate({ rate, className }: { rate: number | null | undefined; className?: string }) {
  const tone = riskTone(rate)
  return (
    <span className={cn('inline-flex items-center gap-1.5', className)} data-tone={tone} data-testid="success-rate">
      <span className={cn('size-2.5 shrink-0 rounded-full', RISK_DOT[tone])} aria-hidden />
      <span>{rateLabel(rate)}</span>
      <span className="sr-only">({RISK_TONE_LABEL[tone]})</span>
    </span>
  )
}

/** Asks for an optional reason, then blocks cash on delivery for the number. */
export function BlockPhoneDialog({ phone, onClose }: { phone: string; onClose: () => void }) {
  const block = useBlockPhoneMutation()
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (block.isPending) return
    setError(null)
    block.mutate(
      { phone, reason: reason.trim() || null },
      {
        onSuccess: () => {
          toast.success(`${phone} is blocked from cash on delivery.`)
          onClose()
        },
        onError: (err) => {
          const map = fieldErrorMap(err)
          setError(map.reason ?? map.phone ?? map.form ?? err.message)
        },
      },
    )
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !block.isPending) onClose() }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Block {phone}?</DialogTitle>
          <DialogDescription>
            Online orders with this number can no longer be paid by cash on delivery; the customer can still pay in advance. Orders your staff enter are not refused.
          </DialogDescription>
        </DialogHeader>
        <form id="block-phone-form" noValidate onSubmit={submit} className="flex flex-col gap-4">
          <FormField label="Reason (optional)" error={error ?? undefined} hint="Only staff see it.">
            <Textarea autoFocus rows={2} maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Refused 3 parcels" />
          </FormField>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={block.isPending}>Back</Button>
          <Button type="submit" form="block-phone-form" variant="destructive" disabled={block.isPending}>
            {block.isPending && <Loader2Icon data-icon="inline-start" className="animate-spin" />}
            Block number
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium tabular-nums">{value}</dd>
    </div>
  )
}

/** BD1b: how earlier orders with the contact number went, and blocking the number from cash on delivery. */
export function DeliveryHistoryCard({ report, timeZone }: { report: PhoneReport; timeZone: string | undefined }) {
  const can = useCan()
  const canManage = can('web_orders.manage')
  const unblock = useUnblockPhoneMutation()
  const [blocking, setBlocking] = useState(false)
  const [confirmUnblock, setConfirmUnblock] = useState(false)
  const [finding, setFinding] = useState(false)

  const doUnblock = async () => {
    setFinding(true)
    try {
      const entry = await findBlockedPhone(report.phone)
      if (!entry) {
        toast.message(`${report.phone} is no longer blocked.`)
        setConfirmUnblock(false)
        return
      }
      await unblock.mutateAsync(entry.id)
      toast.success(`${report.phone} can use cash on delivery again.`)
      setConfirmUnblock(false)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'The number could not be unblocked.')
    } finally {
      setFinding(false)
    }
  }

  return (
    <Card data-testid="delivery-history">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          Delivery history
          {report.blocked && <Badge variant="destructive">Blocked</Badge>}
        </CardTitle>
        <CardDescription>
          Earlier web orders with <span className="font-mono">{report.phone}</span>
          {report.last_order_at && <> · last on {formatDateTime(report.last_order_at, timeZone)}</>}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        {report.orders === 0 ? (
          <p>New number — no earlier orders.</p>
        ) : (
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-5" aria-label="Orders with this number">
            <Stat label="Orders" value={report.orders} />
            <Stat label="Delivered" value={report.delivered} />
            <Stat label="Returned" value={report.returned} />
            <Stat label="Cancelled" value={report.cancelled} />
            <div>
              <dt className="text-muted-foreground">Success rate</dt>
              <dd className="font-medium"><SuccessRate rate={report.success_rate} /></dd>
            </div>
          </dl>
        )}
        {report.blocked && (
          <p role="note" className="rounded-md border border-destructive/30 bg-destructive/5 p-2" data-testid="block-reason">
            Cash on delivery is blocked for this number{report.block_reason ? <>: {report.block_reason}</> : '.'}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {canManage &&
            (report.blocked ? (
              <Button variant="outline" size="sm" onClick={() => setConfirmUnblock(true)}>
                <ShieldCheckIcon data-icon="inline-start" /> Unblock
              </Button>
            ) : (
              <Button variant="outline" size="sm" onClick={() => setBlocking(true)}>
                <BanIcon data-icon="inline-start" /> Block number
              </Button>
            ))}
          <Button asChild variant="link" size="sm" className="h-auto p-0">
            <Link to={`/web-orders?search=${encodeURIComponent(report.phone)}`}>Orders with this number</Link>
          </Button>
        </div>
      </CardContent>
      {blocking && <BlockPhoneDialog phone={report.phone} onClose={() => setBlocking(false)} />}
      <ConfirmDialog
        open={confirmUnblock}
        onOpenChange={setConfirmUnblock}
        title={`Unblock ${report.phone}?`}
        description="Online orders with this number can be paid by cash on delivery again."
        confirmLabel="Unblock"
        destructive={false}
        pending={finding}
        onConfirm={() => void doUnblock()}
      />
    </Card>
  )
}
