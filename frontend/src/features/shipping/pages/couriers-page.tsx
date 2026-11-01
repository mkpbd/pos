import { useState } from 'react'
import { PencilIcon, PlusIcon, Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { EmptyState, ErrorState, LoadingState } from '@/components/common/state-views'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useCouriersQuery, useDeleteCourierMutation, useSaveCourierMutation, type Courier } from '@/features/shipping/api'
import { CourierDialog } from '@/features/shipping/components/courier-dialog'
import { ShippingTabs } from '@/features/shipping/components/shipping-tabs'
import { courierDeleteError, sortCouriers } from '@/features/shipping/shipping'
import { StorefrontHeader } from '@/features/storefront/components/storefront-header'

/** /storefront/shipping/couriers — the delivery companies orders are shipped with. */
export function CouriersPage() {
  const couriers = useCouriersQuery()
  const save = useSaveCourierMutation()
  const remove = useDeleteCourierMutation()
  // undefined = closed, null = new.
  const [editing, setEditing] = useState<Courier | null | undefined>(undefined)
  const [deleting, setDeleting] = useState<Courier | null>(null)
  const [toggling, setToggling] = useState<string | null>(null)
  const list = sortCouriers(couriers.data ?? [])

  const toggle = (courier: Courier, active: boolean) => {
    setToggling(courier.id)
    save.mutate(
      { id: courier.id, input: { is_active: active } },
      {
        onSuccess: () => toast.success(active ? `${courier.name} is offered when shipping.` : `${courier.name} switched off.`),
        onError: (e) => toast.error(e.message),
        onSettled: () => setToggling(null),
      },
    )
  }

  const confirmDelete = () => {
    if (!deleting) return
    const name = deleting.name
    remove.mutate(deleting.id, {
      onSuccess: () => toast.success(`${name} deleted.`),
      onError: (e) => toast.error(courierDeleteError(e, name)),
      onSettled: () => setDeleting(null),
    })
  }

  return (
    <div className="flex flex-col gap-6">
      <StorefrontHeader />
      <ShippingTabs />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-muted-foreground">
          The courier companies you hand parcels to. With a tracking link, customers can follow their parcel from their order page. Switch a courier off to stop
          offering it; one with shipments cannot be deleted.
        </p>
        <Button onClick={() => setEditing(null)}><PlusIcon data-icon="inline-start" /> New courier</Button>
      </div>

      {couriers.isPending ? (
        <LoadingState rows={3} label="Loading couriers" />
      ) : couriers.error ? (
        <ErrorState error={couriers.error} onRetry={() => couriers.refetch()} />
      ) : list.length === 0 ? (
        <EmptyState title="No couriers yet" description="Add the courier companies you ship with, such as Pathao or Steadfast." />
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table aria-label="Couriers">
            <TableHeader>
              <TableRow>
                <TableHead>Courier</TableHead>
                <TableHead className="hidden md:table-cell">Tracking link</TableHead>
                <TableHead>Active</TableHead>
                <TableHead><span className="sr-only">Actions</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>
                    <div className="font-medium">{c.name}</div>
                    {c.phone && <div className="text-xs text-muted-foreground">{c.phone}</div>}
                  </TableCell>
                  <TableCell className="hidden max-w-xs truncate text-sm md:table-cell" title={c.tracking_url_template ?? undefined}>
                    {c.tracking_url_template ?? <span className="text-muted-foreground">None</span>}
                  </TableCell>
                  <TableCell>
                    <Switch aria-label={`${c.name} active`} checked={c.is_active} disabled={toggling === c.id} onCheckedChange={(v) => toggle(c, v)} />
                  </TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    <Button variant="ghost" size="icon-sm" aria-label={`Edit ${c.name}`} onClick={() => setEditing(c)}><PencilIcon /></Button>
                    <Button variant="ghost" size="icon-sm" aria-label={`Delete ${c.name}`} onClick={() => setDeleting(c)}><Trash2Icon /></Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {editing !== undefined && <CourierDialog key={editing?.id ?? 'new'} courier={editing} nextSortOrder={list.length} onClose={() => setEditing(undefined)} />}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && !remove.isPending && setDeleting(null)}
        title={`Delete ${deleting?.name ?? ''}?`}
        description="Only a courier that has never been used can be deleted. One with shipments stays for the record — switch it off instead."
        confirmLabel="Delete"
        pending={remove.isPending}
        onConfirm={confirmDelete}
      />
    </div>
  )
}
