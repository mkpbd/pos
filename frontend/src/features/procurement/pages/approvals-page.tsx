import { useState } from 'react'
import { Link } from 'react-router'
import { BanIcon, CheckIcon, Loader2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { ExportMenu } from '@/components/common/export-menu'
import { PageHeader } from '@/components/common/page-header'
import { PaginationBar } from '@/components/common/pagination-bar'
import { EmptyState, ErrorState, LoadingState } from '@/components/common/state-views'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useAuth, useCan } from '@/features/auth/use-auth'
import { SectionTabs } from '@/features/inventory/components/inventory-tabs'
import { PURCHASING_TABS } from '@/features/inventory/sections'
import { useIdempotencyKey } from '@/features/returns/api'
import {
  approvalsListQuery,
  PROCUREMENT_PERMISSIONS,
  useApprovalsQuery,
  usePurchaseOrderApprovalMutation,
  useRequisitionActionMutation,
  type ApprovalItem,
  type ApprovalKind,
} from '@/features/procurement/api'
import { mayApprove } from '@/features/procurement/procurement'
import { ApprovalLevelBadge, ReasonDialog } from '@/features/procurement/components/shared'
import { formatDateTime } from '@/features/web-orders/orders'
import { formatMoney } from '@/lib/money'

type Filter = 'all' | ApprovalKind

const KIND_LABEL: Record<ApprovalKind, string> = { requisition: 'Requisition', purchase_order: 'Purchase order' }

const docPath = (item: ApprovalItem): string => (item.kind === 'requisition' ? `/purchasing/requisitions/${item.id}` : `/purchasing/orders/${item.id}`)

/** /purchasing/approvals — requisitions and purchase orders waiting for the current user's decision. */
export function ApprovalsPage() {
  const me = useAuth()
  const can = useCan()
  const timeZone = me.organization?.timezone
  const currency = me.organization?.base_currency
  const [filter, setFilter] = useState<Filter>('all')
  const [page, setPage] = useState(1)
  const query = approvalsListQuery({ kind: filter })
  const { data, error, isPending, refetch } = useApprovalsQuery({ ...query, page })
  const [busy, setBusy] = useState<string | null>(null)
  const [rejecting, setRejecting] = useState<ApprovalItem | null>(null)
  const [rejectError, setRejectError] = useState<string | null>(null)
  const requisitionAction = useRequisitionActionMutation()
  const orderAction = usePurchaseOrderApprovalMutation()
  const approveKey = useIdempotencyKey()
  const rejectKey = useIdempotencyKey()

  // Own documents never show up as approvable here, even if the API lists them.
  const shown = (data?.items ?? []).filter((i) => (filter === 'all' || i.kind === filter) && mayApprove({ approval_level: i.level, owner: i.requested_by }, me, can))
  const count = (kind: ApprovalKind): number | null => data?.counts?.[kind] ?? null
  const total = data?.counts ? (data.counts.requisition ?? 0) + (data.counts.purchase_order ?? 0) : null

  const decide = (item: ApprovalItem, decision: 'approve' | 'reject', reason?: string) => {
    const payload = { id: item.id, action: decision, reason }
    const key = decision === 'approve' ? approveKey : rejectKey
    const idempotencyKey = key.keyFor({ kind: item.kind, ...payload })
    setBusy(`${item.kind}:${item.id}`)
    setRejectError(null)
    const callbacks = {
      onSuccess: () => {
        key.settle()
        setRejecting(null)
        toast.success(`${item.number} ${decision === 'approve' ? 'approved' : 'rejected'}.`)
      },
      onError: (e: Error) => {
        key.settle(e)
        if (decision === 'reject') setRejectError(e.message)
        else toast.error(e.message)
      },
      onSettled: () => setBusy(null),
    }
    if (item.kind === 'requisition') requisitionAction.mutate({ ...payload, idempotencyKey }, callbacks)
    else orderAction.mutate({ ...payload, idempotencyKey }, callbacks)
  }

  const canOpen = (item: ApprovalItem) => item.kind === 'requisition' || can(PROCUREMENT_PERMISSIONS.view)

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Purchasing"
        description="Requisitions and purchase orders waiting for your approval."
        actions={<ExportMenu list="approvals" query={query} disabled={!data?.items.length} />}
      />
      <SectionTabs tabs={PURCHASING_TABS} label="Purchasing sections" />
      <div className="overflow-x-auto">
        <Tabs value={filter} onValueChange={(v) => { setFilter(v as Filter); setPage(1) }}>
          <TabsList aria-label="Document type">
            {(['all', 'requisition', 'purchase_order'] as const).map((k) => {
              const n = k === 'all' ? total : count(k)
              return (
                <TabsTrigger key={k} value={k} className="gap-1.5">
                  {k === 'all' ? 'All' : k === 'requisition' ? 'Requisitions' : 'Purchase orders'}
                  {n !== null && <span className="rounded-full bg-background/80 px-1.5 text-xs tabular-nums text-muted-foreground" data-testid={`count-${k}`}>{n}</span>}
                </TabsTrigger>
              )
            })}
          </TabsList>
        </Tabs>
      </div>
      {isPending ? (
        <LoadingState rows={4} label="Loading approvals" />
      ) : error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : shown.length === 0 ? (
        <EmptyState title="Nothing waiting for you" description="Requisitions and purchase orders above the auto-approve limit appear here when you may approve them." />
      ) : (
        <>
        <div className="overflow-x-auto rounded-md border">
          <Table aria-label="Waiting for approval">
            <TableHeader>
              <TableRow>
                <TableHead>Document</TableHead>
                <TableHead className="hidden md:table-cell">Branch / supplier</TableHead>
                <TableHead className="hidden sm:table-cell">Requested by</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="text-right"><span className="sr-only">Decision</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((item) => {
                const rowBusy = busy === `${item.kind}:${item.id}`
                return (
                  <TableRow key={`${item.kind}:${item.id}`}>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-2">
                        {canOpen(item) ? (
                          <Link to={docPath(item)} className="font-mono text-sm underline-offset-4 hover:underline">{item.number}</Link>
                        ) : (
                          <span className="font-mono text-sm">{item.number}</span>
                        )}
                        <Badge variant="outline">{KIND_LABEL[item.kind]}</Badge>
                        <ApprovalLevelBadge level={item.level} />
                      </div>
                      <div className="text-xs text-muted-foreground">Submitted {formatDateTime(item.submitted_at, timeZone)}</div>
                    </TableCell>
                    <TableCell className="hidden text-sm md:table-cell">
                      {[item.branch?.name, item.store?.name].filter(Boolean).join(' · ') || '—'}
                      {item.supplier && <div className="text-xs text-muted-foreground">{item.supplier.name}</div>}
                    </TableCell>
                    <TableCell className="hidden text-sm sm:table-cell">{item.requested_by?.name ?? '—'}</TableCell>
                    <TableCell className="text-right font-mono whitespace-nowrap">{formatMoney(item.amount, item.currency ?? currency)}</TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="outline" aria-label={`Reject ${item.number}`} disabled={rowBusy} onClick={() => { setRejectError(null); setRejecting(item) }}>
                          <BanIcon data-icon="inline-start" /> <span className="hidden sm:inline">Reject</span>
                        </Button>
                        <Button size="sm" aria-label={`Approve ${item.number}`} disabled={rowBusy} onClick={() => decide(item, 'approve')}>
                          {rowBusy ? <Loader2Icon data-icon="inline-start" className="animate-spin" /> : <CheckIcon data-icon="inline-start" />} <span className="hidden sm:inline">Approve</span>
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
        <PaginationBar pagination={data.pagination} onPageChange={setPage} />
        </>
      )}
      <ReasonDialog
        key={rejecting ? `${rejecting.kind}:${rejecting.id}` : 'closed'}
        open={rejecting !== null}
        onOpenChange={(open) => !open && setRejecting(null)}
        title={rejecting ? `Reject ${rejecting.number}` : 'Reject'}
        description={rejecting?.kind === 'purchase_order' ? 'The order goes back to draft with your reason.' : 'The requester is notified with your reason.'}
        confirmLabel="Reject"
        pending={busy !== null}
        error={rejectError}
        onConfirm={(reason) => rejecting && decide(rejecting, 'reject', reason)}
      />
    </div>
  )
}
