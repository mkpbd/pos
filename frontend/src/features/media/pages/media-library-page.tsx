import { useState } from 'react'
import { Loader2Icon, PencilIcon, SearchIcon, Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { FormField } from '@/components/common/form-field'
import { PageHeader } from '@/components/common/page-header'
import { PaginationBar } from '@/components/common/pagination-bar'
import { EmptyState, ErrorState, LoadingState } from '@/components/common/state-views'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { formatBytes, useDeleteMediaMutation, useMediaQuery, useUpdateMediaAltMutation, type MediaItem } from '@/features/media/api'
import { UploadZone } from '@/features/media/components/upload-zone'
import { useDebouncedValue } from '@/lib/use-debounced-value'

function AltTextDialog({ item, onClose }: { item: MediaItem | null; onClose: () => void }) {
  const update = useUpdateMediaAltMutation()
  const [alt, setAlt] = useState('')
  const [seededFor, setSeededFor] = useState<string | null>(null)
  if (item && seededFor !== item.id) {
    setSeededFor(item.id)
    setAlt(item.alt ?? '')
  }

  const save = () => {
    if (!item) return
    update.mutate(
      { id: item.id, alt: alt.trim() || null },
      {
        onSuccess: () => {
          toast.success('Alt text saved.')
          onClose()
        },
        onError: (e) => toast.error(e.message),
      },
    )
  }

  return (
    <Dialog open={item !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Alt text</DialogTitle>
          <DialogDescription>Describes the image for screen readers and search engines.</DialogDescription>
        </DialogHeader>
        <form
          id="alt-form"
          onSubmit={(e) => {
            e.preventDefault()
            save()
          }}
        >
          <FormField label="Alt text" hint={`${alt.length}/200`}>
            <Input autoFocus maxLength={200} value={alt} onChange={(e) => setAlt(e.target.value)} />
          </FormField>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="alt-form" disabled={update.isPending}>
            {update.isPending && <Loader2Icon data-icon="inline-start" className="animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function MediaLibraryPage() {
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const debounced = useDebouncedValue(search, 300)
  const media = useMediaQuery({ page, search: debounced || undefined, per_page: 24 })
  const remove = useDeleteMediaMutation()
  const [editing, setEditing] = useState<MediaItem | null>(null)
  const [deleting, setDeleting] = useState<MediaItem | null>(null)

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Media library" description="Images for the online store: logos, banners, menu promotions. Large images get web-optimised copies automatically." />

      <UploadZone />

      <div className="relative max-w-sm">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="pl-8"
          placeholder="Search by file name or alt text"
          aria-label="Search images"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value)
            setPage(1)
          }}
        />
      </div>

      {media.isPending ? (
        <LoadingState rows={4} label="Loading images" />
      ) : media.error ? (
        <ErrorState error={media.error} onRetry={() => media.refetch()} />
      ) : !media.data.items.length ? (
        <EmptyState title={debounced ? 'No images match your search' : 'No images yet'} description={debounced ? undefined : 'Upload images to use them in the online store.'} />
      ) : (
        <>
          <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6" aria-label="Images">
            {media.data.items.map((m) => (
              <li key={m.id} className="flex flex-col overflow-hidden rounded-md border bg-card">
                <div className="aspect-square bg-muted">
                  <img src={m.url} srcSet={m.srcset} sizes="(min-width: 1280px) 16vw, (min-width: 640px) 33vw, 50vw" alt={m.alt ?? ''} loading="lazy" className="size-full object-contain" />
                </div>
                <div className="flex flex-col gap-1 p-2 text-xs">
                  <span className="truncate font-medium" title={m.original_name}>{m.original_name}</span>
                  <span className="text-muted-foreground">
                    {m.width}×{m.height} · {formatBytes(m.size)}
                  </span>
                  <span className={m.alt ? 'truncate' : 'text-warning-soft-foreground'} title={m.alt ?? undefined}>{m.alt || 'No alt text'}</span>
                  <div className="flex justify-end">
                    <Button variant="ghost" size="icon-sm" aria-label={`Edit alt text of ${m.original_name}`} onClick={() => setEditing(m)}><PencilIcon /></Button>
                    <Button variant="ghost" size="icon-sm" aria-label={`Delete ${m.original_name}`} onClick={() => setDeleting(m)}><Trash2Icon /></Button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
          <PaginationBar pagination={media.data.pagination} onPageChange={setPage} />
        </>
      )}

      <AltTextDialog item={editing} onClose={() => setEditing(null)} />

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`Delete ${deleting?.original_name}?`}
        description="Images used by the theme or a menu cannot be deleted — replace them there first."
        confirmLabel="Delete"
        pending={remove.isPending}
        onConfirm={() =>
          deleting &&
          remove.mutate(deleting.id, {
            onSuccess: () => toast.success(`${deleting.original_name} deleted.`),
            onError: (e) => toast.error(e.message),
            onSettled: () => setDeleting(null),
          })
        }
      />
    </div>
  )
}
