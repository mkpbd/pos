import { useState } from 'react'
import { ReceiptIcon } from 'lucide-react'
import { EmptyState, ErrorState, LoadingState } from '@/components/common/state-views'
import { Badge } from '@/components/ui/badge'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { useSaleQuery, useSalesQuery } from '@/features/sales/api'
import { ReceiptDialog } from '@/features/sales/components/receipt-dialog'
import { formatMoney } from '@/lib/money'

/** Last sales at the till, for reprinting a receipt. */
export function RecentSalesSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { data, error, isPending, refetch } = useSalesQuery({ page: 1, per_page: 15 }, open)
  const [selected, setSelected] = useState<string | null>(null)
  const sale = useSaleQuery(selected ?? undefined)

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Recent sales</SheetTitle>
            <SheetDescription>Open a sale to reprint its receipt.</SheetDescription>
          </SheetHeader>
          <div className="flex flex-col gap-2 px-4 pb-4">
            {isPending ? (
              <LoadingState rows={4} label="Loading sales" />
            ) : error ? (
              <ErrorState error={error} onRetry={() => refetch()} />
            ) : data.items.length === 0 ? (
              <EmptyState title="No sales yet" />
            ) : (
              data.items.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setSelected(s.id)}
                  className="flex items-center gap-3 rounded-md border p-3 text-left text-sm hover:bg-accent"
                >
                  <ReceiptIcon className="size-4 text-muted-foreground" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <div className="font-mono">{s.number}</div>
                    <div className="text-xs text-muted-foreground">{new Date(s.sold_at).toLocaleTimeString()} · {s.customer?.name ?? 'Walk-in'}</div>
                  </div>
                  {s.status === 'cancelled' && <Badge variant="destructive">Cancelled</Badge>}
                  <span className="font-mono">{formatMoney(s.total, s.currency)}</span>
                </button>
              ))
            )}
          </div>
        </SheetContent>
      </Sheet>
      <ReceiptDialog
        sale={sale.data ?? null}
        open={selected !== null}
        onOpenChange={(o) => { if (!o) setSelected(null) }}
        title={sale.data ? `Receipt ${sale.data.number}` : sale.isError ? 'Could not load the sale' : 'Loading receipt…'}
      />
    </>
  )
}
