import { useId, useState, type FormEvent, type ReactNode } from 'react'
import { Loader2Icon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import type { ApprovalLevel } from '@/features/procurement/api'
import { APPROVAL_LEVEL, type TimelineEntry } from '@/features/procurement/procurement'
import { formatDateTime } from '@/features/web-orders/orders'

export const REASON_MAX = 500

/** Approval tier of a document, with who may approve it as a tooltip and screen-reader text. */
export function ApprovalLevelBadge({ level }: { level: ApprovalLevel | null | undefined }) {
  if (!level) return null
  const info = APPROVAL_LEVEL[level]
  return <Badge variant={info.variant} title={info.who}>{info.label}</Badge>
}

/** Reason prompt for a rejection (required, at most 500 characters). Render with a `key` so each opening starts empty. */
export function ReasonDialog({ open, onOpenChange, title, description, confirmLabel, pending, error, onConfirm }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: ReactNode
  confirmLabel: string
  pending: boolean
  error?: string | null
  onConfirm: (reason: string) => void
}) {
  const id = useId()
  const [reason, setReason] = useState('')
  const [touched, setTouched] = useState(false)
  const trimmed = reason.trim()
  const invalid = trimmed === '' ? 'Give a reason.' : trimmed.length > REASON_MAX ? `At most ${REASON_MAX} characters.` : null

  const submit = (e: FormEvent) => {
    e.preventDefault()
    setTouched(true)
    if (!invalid) onConfirm(trimmed)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={id}>Reason</Label>
            <Textarea id={id} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} aria-invalid={(touched && !!invalid) || undefined} aria-describedby={`${id}-hint`} />
            <p id={`${id}-hint`} className={touched && invalid ? 'text-sm text-destructive' : 'text-xs text-muted-foreground'}>
              {touched && invalid ? invalid : `Shown to the requester. ${trimmed.length}/${REASON_MAX}`}
            </p>
          </div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" variant="destructive" disabled={pending}>
              {pending && <Loader2Icon data-icon="inline-start" className="animate-spin" />}
              {confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function Timeline({ entries, timeZone, label }: { entries: TimelineEntry[]; timeZone: string | undefined; label: string }) {
  if (entries.length === 0) return <p className="text-sm text-muted-foreground">No history yet.</p>
  return (
    <ol className="flex flex-col gap-3 border-l pl-4 text-sm" aria-label={label}>
      {entries.map((h, i) => (
        <li key={i} className="relative">
          <span className="absolute top-1.5 -left-[1.3rem] size-2 rounded-full bg-primary" aria-hidden />
          <div className="font-medium">{h.label}</div>
          <div className="text-xs text-muted-foreground">{formatDateTime(h.at, timeZone)}{h.who && ` · ${h.who}`}</div>
          {h.note && <div className="text-xs break-words">{h.note}</div>}
        </li>
      ))}
    </ol>
  )
}

export function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium break-words">{children}</dd>
    </div>
  )
}
