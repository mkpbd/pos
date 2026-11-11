import { useState } from 'react'
import { ArrowDownIcon, ArrowUpIcon, PencilIcon, PlusIcon, Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { EmptyState, ErrorState, LoadingState } from '@/components/common/state-views'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { useCan } from '@/features/auth/use-auth'
import { useMediaLookup } from '@/features/media/api'
import { MediaThumb } from '@/features/media/components/media-picker'
import {
  BANNER_PLACEMENT_HINTS,
  BANNER_PLACEMENT_LABELS,
  BANNER_PLACEMENTS,
  POPUP_DELAY,
  POPUP_FREQUENCY_LABELS,
  useBannersQuery,
  useDeleteBannerMutation,
  useReorderBannersMutation,
  type Banner,
  type BannerPlacement,
} from '@/features/storefront/api'
import { BannerForm } from '@/features/storefront/components/banner-form'
import { StorefrontHeader } from '@/features/storefront/components/storefront-header'

/** "After 5 s · once a day" for a popup banner's row. */
function popupSummary(b: Banner): string {
  const delay = b.popup_delay_seconds ?? POPUP_DELAY.default
  const frequency = POPUP_FREQUENCY_LABELS[b.popup_frequency ?? 'once_per_day'].toLowerCase()
  return `${delay === 0 ? 'Opens right away' : `After ${delay} s`} · ${frequency}`
}

const BANNER_STATE: Record<Banner['state'], { label: string; variant: 'success' | 'soft' | 'info' | 'warning' }> = {
  live: { label: 'Live', variant: 'success' },
  inactive: { label: 'Inactive', variant: 'soft' },
  scheduled: { label: 'Scheduled', variant: 'info' },
  ended: { label: 'Ended', variant: 'warning' },
}

function BannerStatus({ banner }: { banner: Banner }) {
  const state = BANNER_STATE[banner.state]
  return <Badge variant={state.variant}>{state.label}</Badge>
}

function PlacementCard({ placement, banners, canManage, onEdit, onAdd, onDelete }: {
  placement: BannerPlacement
  banners: Banner[]
  canManage: boolean
  onEdit: (b: Banner) => void
  onAdd: () => void
  onDelete: (b: Banner) => void
}) {
  const reorder = useReorderBannersMutation()
  const { byId } = useMediaLookup(banners.map((b) => b.desktop_media_id))
  // The storefront shows a single popup: the first live one in this order.
  const shownPopupId = placement === 'popup' ? banners.find((b) => b.is_live)?.id : undefined

  const move = (index: number, direction: -1 | 1) => {
    const ids = banners.map((b) => b.id)
    const [moved] = ids.splice(index, 1)
    if (moved) ids.splice(index + direction, 0, moved)
    reorder.mutate({ placement, ids }, { onError: (e) => toast.error(e.message) })
  }

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
        <div>
          <CardTitle>{BANNER_PLACEMENT_LABELS[placement]}</CardTitle>
          <CardDescription>{BANNER_PLACEMENT_HINTS[placement]}</CardDescription>
        </div>
        {canManage && <Button variant="outline" size="sm" onClick={onAdd}><PlusIcon data-icon="inline-start" /> Add banner</Button>}
      </CardHeader>
      <CardContent>
        {banners.length === 0 ? (
          <EmptyState title="No banners yet" />
        ) : (
          <ol className="flex flex-col divide-y" aria-label={`${BANNER_PLACEMENT_LABELS[placement]} banners`}>
            {banners.map((b, i) => (
              <li key={b.id} className="flex flex-wrap items-center gap-3 py-3">
                <MediaThumb id={b.desktop_media_id} byId={byId} className="h-14 w-24" />
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{b.name}</p>
                  <p className="truncate text-sm text-muted-foreground">{b.title ?? 'No headline'}</p>
                  {placement === 'popup' && <p className="text-sm text-muted-foreground">{popupSummary(b)}</p>}
                </div>
                {placement === 'popup' && b.is_live && b.id !== shownPopupId && <Badge variant="outline">Not shown (another popup comes first)</Badge>}
                <BannerStatus banner={b} />
                {canManage && (
                  <div className="flex items-center">
                    <Button variant="ghost" size="icon-sm" aria-label={`Move ${b.name} up`} disabled={i === 0 || reorder.isPending} onClick={() => move(i, -1)}><ArrowUpIcon /></Button>
                    <Button variant="ghost" size="icon-sm" aria-label={`Move ${b.name} down`} disabled={i === banners.length - 1 || reorder.isPending} onClick={() => move(i, 1)}><ArrowDownIcon /></Button>
                    <Button variant="ghost" size="icon-sm" aria-label={`Edit ${b.name}`} onClick={() => onEdit(b)}><PencilIcon /></Button>
                    <Button variant="ghost" size="icon-sm" aria-label={`Delete ${b.name}`} onClick={() => onDelete(b)}><Trash2Icon /></Button>
                  </div>
                )}
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  )
}

export function BannersPage() {
  const can = useCan()
  const canManage = can('storefront.manage')
  const banners = useBannersQuery()
  const remove = useDeleteBannerMutation()
  const [editing, setEditing] = useState<{ placement: BannerPlacement; banner?: Banner } | null>(null)
  const [deleting, setDeleting] = useState<Banner | null>(null)

  return (
    <div className="flex flex-col gap-6">
      <StorefrontHeader />
      {banners.isPending ? (
        <LoadingState label="Loading banners" />
      ) : banners.error ? (
        <ErrorState error={banners.error} onRetry={() => banners.refetch()} />
      ) : (
        BANNER_PLACEMENTS.map((placement) => (
          <PlacementCard
            key={placement}
            placement={placement}
            banners={banners.data.filter((b) => b.placement === placement)}
            canManage={canManage}
            onAdd={() => setEditing({ placement })}
            onEdit={(banner) => setEditing({ placement, banner })}
            onDelete={setDeleting}
          />
        ))
      )}

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-2xl">
          {editing && <BannerForm placement={editing.placement} banner={editing.banner} onDone={() => setEditing(null)} />}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Delete this banner?"
        description="A banner shown by a homepage section cannot be deleted; remove it from the section first."
        confirmLabel="Delete banner"
        pending={remove.isPending}
        onConfirm={() =>
          deleting &&
          remove.mutate(deleting.id, {
            onSuccess: () => {
              toast.success('Banner deleted.')
              setDeleting(null)
            },
            onError: (e) => {
              setDeleting(null)
              toast.error(e.message)
            },
          })
        }
      />
    </div>
  )
}
