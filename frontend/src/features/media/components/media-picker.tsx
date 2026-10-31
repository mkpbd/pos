import { useState } from 'react'
import { CheckIcon, ImageIcon, SearchIcon, XIcon } from 'lucide-react'
import { PaginationBar } from '@/components/common/pagination-bar'
import { EmptyState, ErrorState, LoadingState } from '@/components/common/state-views'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useMediaLookup, useMediaQuery, type MediaItem } from '@/features/media/api'
import { UploadZone } from '@/features/media/components/upload-zone'
import { useDebouncedValue } from '@/lib/use-debounced-value'
import { cn } from '@/lib/utils'

type PickerProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  multiple?: boolean
  /** Currently chosen ids (pre-selected when the dialog opens). */
  selected: string[]
  /** Upper bound for multiple selection. */
  max?: number
  onConfirm: (ids: string[]) => void
}

/** Choose one or several images from the media library, or upload new ones on the spot. */
export function MediaPicker({ open, onOpenChange, title, multiple = false, selected, max, onConfirm }: PickerProps) {
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const debounced = useDebouncedValue(search, 300)
  const [chosen, setChosen] = useState<string[]>(selected)
  const [wasOpen, setWasOpen] = useState(open)
  const media = useMediaQuery({ page, search: debounced || undefined, per_page: 24 })

  // Re-seed the selection each time the dialog opens.
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) setChosen(selected)
  }

  const toggle = (id: string) => {
    if (!multiple) {
      setChosen([id])
      return
    }
    setChosen((current) => (current.includes(id) ? current.filter((x) => x !== id) : max && current.length >= max ? current : [...current, id]))
  }

  const onUploaded = (items: MediaItem[]) => {
    if (multiple) setChosen((current) => [...current, ...items.map((i) => i.id).filter((id) => !current.includes(id))].slice(0, max ?? Infinity))
    else if (items[0]) setChosen([items[0].id])
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{multiple ? `Select images${max ? ` (up to ${max})` : ''}.` : 'Select one image.'}</DialogDescription>
        </DialogHeader>

        <UploadZone compact onUploaded={onUploaded} />

        <div className="relative">
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
          <LoadingState rows={2} label="Loading images" />
        ) : media.error ? (
          <ErrorState error={media.error} onRetry={() => media.refetch()} />
        ) : !media.data.items.length ? (
          <EmptyState title="No images yet" description="Upload one above." />
        ) : (
          <>
            <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6" aria-label="Images">
              {media.data.items.map((m) => {
                const isChosen = chosen.includes(m.id)
                return (
                  <li key={m.id}>
                    <button
                      type="button"
                      aria-pressed={isChosen}
                      aria-label={m.alt || m.original_name}
                      onClick={() => toggle(m.id)}
                      className={cn('relative block aspect-square w-full overflow-hidden rounded-md border bg-muted', isChosen && 'ring-2 ring-primary ring-offset-2')}
                    >
                      <img src={m.url} srcSet={m.srcset} sizes="120px" alt="" loading="lazy" className="size-full object-contain" />
                      {isChosen && (
                        <span className="absolute top-1 right-1 rounded-full bg-primary p-0.5 text-primary-foreground">
                          <CheckIcon className="size-3" />
                        </span>
                      )}
                    </button>
                  </li>
                )
              })}
            </ul>
            <PaginationBar pagination={media.data.pagination} onPageChange={setPage} />
          </>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            type="button"
            disabled={!multiple && chosen.length === 0}
            onClick={() => {
              onConfirm(chosen)
              onOpenChange(false)
            }}
          >
            {multiple ? `Use ${chosen.length} image${chosen.length === 1 ? '' : 's'}` : 'Use image'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Thumbnail for a media id; ids not among the newest items show a neutral tile. */
export function MediaThumb({ id, byId, className }: { id: string; byId: Map<string, MediaItem>; className?: string }) {
  const item = byId.get(id)
  return (
    <span className={cn('flex size-16 items-center justify-center overflow-hidden rounded-md border bg-muted', className)}>
      {item ? <img src={item.url} srcSet={item.srcset} sizes="64px" alt={item.alt ?? item.original_name} className="size-full object-contain" /> : <ImageIcon className="size-5 text-muted-foreground" aria-label="Selected image" />}
    </span>
  )
}

/** A single-image setting: preview, "Choose" and "Remove". */
export function MediaField({ value, onChange, title, disabled }: { value: string | null; onChange: (id: string | null) => void; title: string; disabled?: boolean }) {
  const [open, setOpen] = useState(false)
  const { byId } = useMediaLookup(value ? [value] : [])

  return (
    <div className="flex items-center gap-3">
      {value ? <MediaThumb id={value} byId={byId} /> : <span className="flex size-16 items-center justify-center rounded-md border border-dashed text-xs text-muted-foreground">None</span>}
      {!disabled && (
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>{value ? 'Change' : 'Choose'}</Button>
          {value && (
            <Button type="button" variant="ghost" size="sm" onClick={() => onChange(null)}>
              <XIcon data-icon="inline-start" /> Remove
            </Button>
          )}
        </div>
      )}
      <MediaPicker open={open} onOpenChange={setOpen} title={title} selected={value ? [value] : []} onConfirm={(ids) => onChange(ids[0] ?? null)} />
    </div>
  )
}
