import { useCallback, useRef, useState } from 'react'
import { ShieldCheckIcon, UserRoundIcon } from 'lucide-react'
import { ErrorState, LoadingState } from '@/components/common/state-views'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { PinPad, PinProblemMessage } from '@/features/pos/components/pin-pad'
import { ApprovalContext, type ApprovalRequest, type RequestApproval } from '@/features/pos/manager-approval-context'
import { usePinProblem } from '@/features/pos/till-helpers'
import { pinProblem, useApproversQuery, useCreateApprovalMutation, type Approval, type ApprovalAction } from '@/features/pos/till-api'
import { ApiError } from '@/lib/api/client'
import { cn } from '@/lib/utils'

const ACTION_TITLE: Record<ApprovalAction, string> = {
  price_override: 'Approve a price change',
  discount: 'Approve a discount',
  return: 'Approve a return',
}

/** Provides `useManagerApproval()` for the till's store: one approval dialog at a time. */
export function ManagerApprovalProvider({ storeId, children }: { storeId: string | null; children: React.ReactNode }) {
  const [pending, setPending] = useState<ApprovalRequest | null>(null)
  const resolver = useRef<((approval: Approval | null) => void) | null>(null)

  const request = useCallback<RequestApproval>((next) => {
    resolver.current?.(null)
    setPending(next)
    return new Promise((resolve) => {
      resolver.current = resolve
    })
  }, [])

  const finish = (approval: Approval | null) => {
    resolver.current?.(approval)
    resolver.current = null
    setPending(null)
  }

  return (
    <ApprovalContext.Provider value={request}>
      {children}
      {pending && <ManagerApprovalDialog request={pending} storeId={storeId} onDone={finish} />}
    </ApprovalContext.Provider>
  )
}

/**
 * Pick the approving manager, who types their PIN on this till. Cancelling changes nothing.
 * A refused PIN (wrong, locked, not allowed) is shown and the PIN cleared.
 */
export function ManagerApprovalDialog({ request, storeId, onDone }: { request: ApprovalRequest; storeId: string | null; onDone: (approval: Approval | null) => void }) {
  const approvers = useApproversQuery(request.action, storeId, true)
  const approve = useCreateApprovalMutation()
  const [chosen, setChosen] = useState<string | null>(null)
  const [pin, setPin] = useState('')
  const problem = usePinProblem()
  const list = approvers.data ?? []
  const approverId = chosen ?? (list.length === 1 ? list[0]!.id : null)

  const submit = (value: string) => {
    if (!approverId || !storeId || approve.isPending) return
    problem.show(null)
    approve.mutate(
      { action: request.action, approver_id: approverId, pin: value, store_id: storeId, ...(request.details ? { details: request.details } : {}) },
      {
        onSuccess: (approval) => onDone(approval),
        onError: (error) => {
          setPin('')
          problem.show(
            error instanceof ApiError && error.code === 'APPROVER_NOT_ALLOWED'
              ? { message: error.message || 'This person cannot approve this here.', retryAfter: null, passwordOnly: false }
              : pinProblem(error),
          )
        },
      },
    )
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !approve.isPending) onDone(null) }}>
      <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><ShieldCheckIcon className="size-5" aria-hidden /> {ACTION_TITLE[request.action]}</DialogTitle>
          <DialogDescription>{request.description} A manager approves with their till PIN.</DialogDescription>
        </DialogHeader>
        {approvers.isPending ? (
          <LoadingState rows={2} label="Loading approvers" />
        ) : approvers.error ? (
          <ErrorState error={approvers.error} onRetry={() => approvers.refetch()} />
        ) : list.length === 0 ? (
          <p role="alert" className="rounded-md border p-3 text-sm text-muted-foreground">
            Nobody who can approve this has a till PIN for this store. A manager can set one under Profile & security.
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            <div role="radiogroup" aria-label="Approved by" className="flex flex-wrap gap-2">
              {list.map((a) => (
                <Button
                  key={a.id}
                  type="button"
                  role="radio"
                  aria-checked={approverId === a.id}
                  variant={approverId === a.id ? 'default' : 'outline'}
                  className={cn('h-auto py-2')}
                  onClick={() => { setChosen(a.id); setPin(''); problem.show(null) }}
                >
                  <UserRoundIcon data-icon="inline-start" /> {a.name}
                </Button>
              ))}
            </div>
            {approverId ? (
              <PinPad
                label="Manager PIN"
                value={pin}
                onChange={setPin}
                onSubmit={submit}
                submitLabel="Approve"
                pending={approve.isPending}
                disabled={problem.lockedOut}
              />
            ) : (
              <p className="text-sm text-muted-foreground">Choose who approves.</p>
            )}
            <PinProblemMessage problem={problem.problem} lockedOut={problem.lockedOut} secondsLeft={problem.secondsLeft} />
          </div>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" disabled={approve.isPending} onClick={() => onDone(null)}>Cancel</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
