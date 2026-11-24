import { useState } from 'react'
import { BanIcon, PlusIcon } from 'lucide-react'
import { ExportMenu } from '@/components/common/export-menu'
import { PageHeader } from '@/components/common/page-header'
import { PaginationBar } from '@/components/common/pagination-bar'
import { EmptyState, ErrorState, LoadingState } from '@/components/common/state-views'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useCan } from '@/features/auth/use-auth'
import { SectionTabs } from '@/features/inventory/components/inventory-tabs'
import { PURCHASING_TABS } from '@/features/inventory/sections'
import { PAYMENT_METHODS, useSupplierRefundsQuery } from '@/features/purchasing/api'
import { RecordRefundDialog, VoidNote, VoidSupplierMoneyDialog, type VoidTarget } from '@/features/purchasing/pages/payment-pages'
import { formatMoney } from '@/lib/money'

/** /purchasing/supplier-refunds — money suppliers gave back (ST1), with voids. */
export function SupplierRefundsPage() {
  const can = useCan()
  const [page, setPage] = useState(1)
  const [recording, setRecording] = useState(false)
  const [voiding, setVoiding] = useState<VoidTarget | null>(null)
  const { data, error, isPending, refetch } = useSupplierRefundsQuery({ page })
  const canPay = can('purchases.pay')

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Purchasing"
        description="Money suppliers gave back: overpayments and credit for returned goods."
        actions={
          <>
            <ExportMenu list="supplierRefunds" disabled={!data?.items.length} />
            {canPay && <Button onClick={() => setRecording(true)}><PlusIcon data-icon="inline-start" /> Record refund</Button>}
          </>
        }
      />
      <SectionTabs tabs={PURCHASING_TABS} label="Purchasing sections" />
      {isPending ? (
        <LoadingState rows={4} label="Loading refunds" />
      ) : error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : data.items.length === 0 ? (
        <EmptyState title="No supplier refunds yet" description="Record one when a supplier pays you back." />
      ) : (
        <>
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Number</TableHead>
                  <TableHead>Supplier</TableHead>
                  <TableHead>Received on</TableHead>
                  <TableHead className="hidden sm:table-cell">Method</TableHead>
                  <TableHead className="hidden md:table-cell">Reference</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  {canPay && <TableHead><span className="sr-only">Actions</span></TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((r) => (
                  <TableRow key={r.id} className={r.voided_at ? 'text-muted-foreground' : undefined}>
                    <TableCell className="font-mono text-sm">
                      {r.number}
                      {r.voided_at && <Badge variant="destructive" className="ml-2">Voided</Badge>}
                    </TableCell>
                    <TableCell className="text-sm">{r.supplier?.name}<VoidNote doc={r} /></TableCell>
                    <TableCell className="text-sm">{r.received_on}</TableCell>
                    <TableCell className="hidden sm:table-cell"><Badge variant="outline">{PAYMENT_METHODS[r.method] ?? r.method}</Badge></TableCell>
                    <TableCell className="hidden font-mono text-sm md:table-cell">{r.reference ?? '—'}</TableCell>
                    <TableCell className={r.voided_at ? 'text-right font-mono line-through' : 'text-right font-mono'}>{formatMoney(r.amount, r.currency)}</TableCell>
                    {canPay && (
                      <TableCell className="text-right">
                        {!r.voided_at && <Button variant="ghost" size="icon-sm" aria-label={`Void ${r.number}`} onClick={() => setVoiding({ kind: 'refund', doc: r })}><BanIcon /></Button>}
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <PaginationBar pagination={data.pagination} onPageChange={setPage} />
        </>
      )}
      {canPay && <RecordRefundDialog open={recording} onOpenChange={setRecording} />}
      {canPay && <VoidSupplierMoneyDialog target={voiding} onOpenChange={(o) => { if (!o) setVoiding(null) }} />}
    </div>
  )
}
