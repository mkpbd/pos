import { useState } from 'react'
import { PlayIcon, Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { EmptyState, ErrorState, LoadingState } from '@/components/common/state-views'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { fetchHeldSale, useDiscardHeldMutation, useHeldSalesQuery, type HeldSale } from '@/features/pos/api'

/** Carts parked at this store; resuming one replaces the (empty) current cart. */
export function HeldSalesSheet({
  open,
  onOpenChange,
  storeId,
  onResume,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  storeId: string | null
  onResume: (held: HeldSale) => Promise<void>
}) {
  const { data, error, isPending, refetch } = useHeldSalesQuery(storeId, open)
  const discard = useDiscardHeldMutation()
  const [resuming, setResuming] = useState<string | null>(null)

  const resume = async (id: string) => {
    setResuming(id)
    try {
      await onResume(await fetchHeldSale(id))
      onOpenChange(false)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not resume the cart.')
    } finally {
      setResuming(null)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Held sales</SheetTitle>
          <SheetDescription>Resumed carts are priced again at today's prices.</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-2 px-4 pb-4">
          {isPending ? (
            <LoadingState rows={3} label="Loading held sales" />
          ) : error ? (
            <ErrorState error={error} onRetry={() => refetch()} />
          ) : data.length === 0 ? (
            <EmptyState title="No held sales" description="Press F8 to park the current cart." />
          ) : (
            data.map((h) => (
              <div key={h.id} className="flex items-center gap-3 rounded-md border p-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{h.label ?? h.customer?.name ?? 'Walk-in customer'}</div>
                  <div className="text-xs text-muted-foreground">
                    {h.lines_count} {h.lines_count === 1 ? 'line' : 'lines'} · {new Date(h.created_at).toLocaleTimeString()}{h.created_by && ` · ${h.created_by}`}
                  </div>
                </div>
                <Button size="sm" onClick={() => resume(h.id)} disabled={resuming !== null}>
                  <PlayIcon data-icon="inline-start" /> Resume
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Discard held sale ${h.label ?? h.customer?.name ?? ''}`.trim()}
                  onClick={() => discard.mutate(h.id, { onSuccess: () => toast.success('Held sale discarded.'), onError: (e) => toast.error(e.message) })}
                >
                  <Trash2Icon />
                </Button>
              </div>
            ))
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
