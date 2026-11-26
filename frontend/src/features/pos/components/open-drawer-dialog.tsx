import { useRef, useState } from 'react'
import { Loader2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { FormField } from '@/components/common/form-field'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useCan } from '@/features/auth/use-auth'
import { DRAWER_REASON_MAX, useOpenDrawerMutation, type DrawerOpeningInput } from '@/features/pos/drawer-api'
import { useManagerApproval } from '@/features/pos/manager-approval-context'
import { hasDirectPrinter, loadPrinterSettings } from '@/features/pos/printing/printer-settings'
import { kickDrawer } from '@/features/pos/printing/till-printer'
import { ApiError } from '@/lib/api/client'

/**
 * POS1d: "Open drawer" without a sale. The cashier gives a reason; without `pos.no_sale` a manager
 * approves by PIN. The opening is recorded on the register session, then the printer kicks the
 * drawer (no printer: the cashier opens it by hand).
 */
export function OpenDrawerDialog({ storeId, onClose }: { storeId: string | null; onClose: () => void }) {
  const can = useCan()
  const requestApproval = useManagerApproval()
  const open = useOpenDrawerMutation()
  const [reason, setReason] = useState('')
  const [touched, setTouched] = useState(false)
  const [asking, setAsking] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  // The same request (after a timeout) reuses its key, so one opening is recorded once.
  const pending = useRef<{ fingerprint: string; key: string } | null>(null)

  const trimmed = reason.trim()
  const reasonError = trimmed === '' ? 'Say why the drawer is opened.' : trimmed.length > DRAWER_REASON_MAX ? `At most ${DRAWER_REASON_MAX} characters.` : null
  const busy = asking || open.isPending

  const afterRecorded = async () => {
    onClose()
    const settings = loadPrinterSettings()
    if (!hasDirectPrinter(settings)) {
      toast.success('Drawer opening recorded — open it by hand.')
      return
    }
    try {
      await kickDrawer(settings)
      toast.success('Drawer opened.')
    } catch (error) {
      toast.error(`Drawer opening recorded, but the printer did not open it — open it by hand. ${error instanceof Error ? error.message : ''}`.trim())
    }
  }

  const submit = async (forceApproval = false) => {
    if (reasonError || busy || !storeId) return
    setProblem(null)
    let approvalId: string | null = null
    if (forceApproval || !can('pos.no_sale')) {
      setAsking(true)
      const approval = await requestApproval({
        action: 'no_sale',
        description: `${forceApproval ? 'A manager’s approval is needed. ' : ''}Open the cash drawer without a sale: “${trimmed}”.`,
      }).finally(() => setAsking(false))
      if (!approval) return
      approvalId = approval.id
    }
    const input: DrawerOpeningInput = { store_id: storeId, reason: trimmed, ...(approvalId ? { approval_id: approvalId } : {}) }
    const fingerprint = JSON.stringify(input)
    const key = pending.current?.fingerprint === fingerprint ? pending.current.key : crypto.randomUUID()
    pending.current = { fingerprint, key }
    open.mutate({ input, idempotencyKey: key }, {
      onSuccess: () => {
        pending.current = null
        void afterRecorded()
      },
      onError: (error) => {
        const retryable = !(error instanceof ApiError) || error.status === 0 || error.status >= 500
        if (!retryable) pending.current = null
        if (error instanceof ApiError && error.code === 'APPROVAL_REQUIRED' && !forceApproval) {
          // The server wants a manager after all (or the approval expired): ask once more.
          void submit(true)
          return
        }
        setProblem(error instanceof ApiError && error.code === 'CASH_SESSION_REQUIRED' ? 'Open a register session in this branch first.' : error.message)
      },
    })
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Open drawer</DialogTitle>
          <DialogDescription>
            No money moves. The opening is recorded on your register session with the reason{can('pos.no_sale') ? '' : ', after a manager approves with their PIN'}.
          </DialogDescription>
        </DialogHeader>
        <form id="open-drawer-form" noValidate onSubmit={(e) => { e.preventDefault(); setTouched(true); void submit() }}>
          <FormField label="Reason" error={touched ? reasonError ?? undefined : undefined}>
            <Input autoFocus maxLength={DRAWER_REASON_MAX} placeholder="e.g. Change for the next customer" value={reason} onChange={(e) => setReason(e.target.value)} />
          </FormField>
          {!storeId && <p role="alert" className="mt-2 text-sm text-destructive">Choose the store you sell from first.</p>}
          {problem && <p role="alert" className="mt-2 text-sm text-destructive">{problem}</p>}
        </form>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={onClose}>Cancel</Button>
          <Button type="submit" form="open-drawer-form" disabled={busy || !storeId}>
            {busy && <Loader2Icon data-icon="inline-start" className="animate-spin" />}
            Open drawer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
