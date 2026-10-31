import { useState } from 'react'
import { Link } from 'react-router'
import { ArrowDownToLineIcon, ArrowUpFromLineIcon, LockIcon, PlayIcon, WalletIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { PaymentDirection } from '@/features/payments/api'
import { CashMovementDialog, CloseSessionDialog, OpenSessionDialog } from '@/features/registers/components/session-dialogs'
import type { SessionReport } from '@/features/registers/api'
import { formatMoney } from '@/lib/money'

/**
 * The cashier's shift at the till. Checkout needs an open session in the active branch
 * (`CASH_SESSION_REQUIRED`), so without one this bar is the first thing to act on.
 */
export function RegisterSessionBar({
  session,
  loading,
  branchId,
  branchName,
  openRequested,
  onOpenRequestedChange,
}: {
  session: SessionReport | null | undefined
  loading: boolean
  branchId: string
  branchName: string | undefined
  /** The terminal asks for the open dialog, e.g. when Pay is pressed without a session. */
  openRequested: boolean
  onOpenRequestedChange: (open: boolean) => void
}) {
  const [moving, setMoving] = useState<PaymentDirection | null>(null)
  const [closing, setClosing] = useState(false)

  if (loading) return null

  if (session && session.branch?.id !== branchId) {
    return (
      <div role="status" className="flex flex-wrap items-center gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
        <WalletIcon className="size-4 shrink-0" aria-hidden />
        Your session <span className="font-mono">{session.number}</span> is open in {session.branch?.name}. Switch to that branch, or
        <Button variant="link" size="sm" className="h-auto px-0" asChild><Link to={`/cash-registers/sessions/${session.id}`}>close it</Link></Button>
        to sell in {branchName ?? 'this branch'}.
      </div>
    )
  }

  if (!session) {
    return (
      <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
        <span className="flex items-center gap-2"><WalletIcon className="size-4 shrink-0" aria-hidden /> No open register session. Open one with a counted float before the first sale.</span>
        <Button size="sm" onClick={() => onOpenRequestedChange(true)}><PlayIcon data-icon="inline-start" /> Open register</Button>
        <OpenSessionDialog open={openRequested} onOpenChange={onOpenRequestedChange} branchId={branchId} />
      </div>
    )
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-card px-3 py-1.5 text-sm" aria-label="Register session">
      <span className="flex flex-wrap items-center gap-x-2">
        <WalletIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <Link to={`/cash-registers/sessions/${session.id}`} className="font-mono underline-offset-4 hover:underline">{session.number}</Link>
        <span className="text-muted-foreground">{session.register?.name}</span>
        <span className="text-muted-foreground">· cash expected</span>
        <span className="font-mono font-medium" data-testid="session-expected-cash">{formatMoney(session.cash.expected, session.currency)}</span>
      </span>
      <span className="flex gap-1">
        <Button variant="ghost" size="sm" onClick={() => setMoving('in')}><ArrowDownToLineIcon data-icon="inline-start" /> Cash in</Button>
        <Button variant="ghost" size="sm" onClick={() => setMoving('out')}><ArrowUpFromLineIcon data-icon="inline-start" /> Cash out</Button>
        <Button variant="ghost" size="sm" onClick={() => setClosing(true)}><LockIcon data-icon="inline-start" /> Close</Button>
      </span>
      {moving && <CashMovementDialog open onOpenChange={(o) => !o && setMoving(null)} session={session} direction={moving} />}
      <CloseSessionDialog open={closing} onOpenChange={setClosing} session={session} />
    </div>
  )
}
