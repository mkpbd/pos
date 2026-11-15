import { useId, useState, type FormEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { BookmarkPlusIcon, CalendarClockIcon, ClipboardCheckIcon, ColumnsIcon, ExternalLinkIcon, HistoryIcon, Loader2Icon, PencilIcon, Trash2Icon, XIcon } from 'lucide-react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { ErrorState, LoadingState } from '@/components/common/state-views'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ApiError } from '@/lib/api/client'
import type { CanvasSurroundings } from '@/storefront/builder/canvas/protocol'
import type { CanvasThemeSettings } from '@/storefront/builder/canvas/theme-override'
import type { StorefrontBootstrap } from '@/storefront/types'
import { useCurrentUserQuery } from '@/features/auth/api'
import { formatStoreTime } from './schedule-time'
import {
  CHECKPOINT_LIMIT,
  deleteCheckpoint,
  fetchCompare,
  fetchLiveRender,
  fetchVersionRender,
  publishingKeys,
  renameVersion,
  saveCheckpoint,
  useVersionEntries,
  VERSION_NAME_MAX,
  type CompareSide,
  type RenderPayload,
  type VersionEntry,
} from '../publishing-api'
import { SideBySide, type ChangesState, type Side } from './side-by-side'
import { entryTitle } from './version-names'

/*
 * B11 version history: published versions and the draft's named copies ("checkpoints"), newest
 * first. Each can be renamed, compared side by side with the draft (or anything else) and restored
 * into the draft. "Save a named copy" keeps the draft as it is now without publishing it.
 */

/** What compare and restore need from the editor. */
export type CompareSupport = {
  bootstrap: StorefrontBootstrap
  surroundings: CanvasSurroundings
  emptyText?: string
  theme?: CanvasThemeSettings | null
  /** The draft as the editor draws it now. */
  draft: () => RenderPayload
  typeLabel: (type: string) => string
}

type Props = {
  documentId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  liveVersionId: string | null
  /** The live page on the store, or null without a store address. */
  liveUrl: string | null
  canRestore: boolean
  /** Rename and save named copies. */
  canManage?: boolean
  onRestore: (entry: VersionEntry) => Promise<void>
  /** Saves the editor's latest changes first (named copies and compares use the saved draft). */
  flush?: () => Promise<boolean>
  compare?: CompareSupport
}

function RenameForm({ entry, onDone, documentId }: { entry: VersionEntry; onDone: () => void; documentId: string }) {
  const queryClient = useQueryClient()
  const [value, setValue] = useState(entry.name ?? '')
  const [busy, setBusy] = useState(false)
  const id = useId()
  const save = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    try {
      await renameVersion(documentId, entry.id, value.trim() || null)
      await queryClient.invalidateQueries({ queryKey: publishingKeys.versions(documentId) })
      toast.success(value.trim() ? 'Name saved.' : 'Name removed.')
      onDone()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'The name could not be saved.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => void save(e)}>
      <Label htmlFor={id} className="sr-only">
        Name for {entry.kind === 'version' && entry.number !== null ? `version ${entry.number}` : 'this saved copy'}
      </Label>
      <Input
        id={id}
        value={value}
        maxLength={VERSION_NAME_MAX}
        autoFocus
        className="h-8 w-56"
        placeholder="e.g. Eid sale"
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            e.stopPropagation()
            onDone()
          }
        }}
      />
      <Button type="submit" size="sm" disabled={busy}>
        {busy && <Loader2Icon className="animate-spin" aria-hidden />} Save name
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={onDone}>
        Cancel
      </Button>
    </form>
  )
}

function CheckpointForm({ documentId, count, flush }: { documentId: string; count: number; flush?: () => Promise<boolean> }) {
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const id = useId()
  const save = async (event: FormEvent) => {
    event.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) {
      setError('Give the copy a name, so you can find it again.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      if (flush && !(await flush())) {
        setError('Your latest changes could not be saved yet. Try again in a moment.')
        return
      }
      await saveCheckpoint(documentId, trimmed)
      await queryClient.invalidateQueries({ queryKey: publishingKeys.versions(documentId) })
      setName('')
      toast.success(`“${trimmed}” is saved. Nothing changed on your shop.`)
    } catch (e) {
      setError(
        e instanceof ApiError && e.code === 'CHECKPOINT_LIMIT'
          ? `You already have ${CHECKPOINT_LIMIT} named copies. Delete one you no longer need, then save again.`
          : e instanceof Error
            ? e.message
            : 'The copy could not be saved.',
      )
    } finally {
      setBusy(false)
    }
  }
  return (
    <form className="flex flex-col gap-1.5 rounded-md border bg-muted/30 p-3" onSubmit={(e) => void save(e)} noValidate>
      <Label htmlFor={id}>Save a named copy of your draft</Label>
      <p id={`${id}-hint`} className="text-xs text-muted-foreground">
        Keeps the draft as it is now, so you can come back to it. It is not published. Up to {CHECKPOINT_LIMIT} copies are kept.
        {count >= CHECKPOINT_LIMIT && ' You have reached that: delete one to save another.'}
      </p>
      <div className="flex flex-wrap gap-2">
        <Input
          id={id}
          value={name}
          maxLength={VERSION_NAME_MAX}
          placeholder="e.g. Before the Eid changes"
          className="h-9 min-w-0 flex-1"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-hint ${id}-error` : `${id}-hint`}
          onChange={(e) => {
            setName(e.target.value)
            setError(null)
          }}
        />
        <Button type="submit" variant="outline" disabled={busy}>
          {busy ? <Loader2Icon className="animate-spin" aria-hidden /> : <BookmarkPlusIcon aria-hidden />} Save a named copy
        </Button>
      </div>
      {error && (
        <p id={`${id}-error`} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </form>
  )
}

export function VersionHistoryDialog({ documentId, open, onOpenChange, liveVersionId, liveUrl, canRestore, canManage = true, onRestore, flush, compare }: Props) {
  const versions = useVersionEntries(documentId, open)
  const timeZone = useCurrentUserQuery().data?.organization?.timezone
  const [restoring, setRestoring] = useState<VersionEntry | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<VersionEntry | null>(null)
  const queryClient = useQueryClient()
  const [comparing, setComparing] = useState<{ left: CompareSide; right: CompareSide } | null>(null)
  const [busy, setBusy] = useState(false)
  const entries = versions.data ?? []
  const checkpoints = entries.filter((e) => e.kind === 'checkpoint').length

  const restoreLabel = (entry: VersionEntry) => (entry.kind === 'version' && entry.number !== null ? `version ${entry.number}` : `“${entryTitle(entry)}”`)

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <HistoryIcon className="size-5" aria-hidden /> Version history
            </DialogTitle>
            <DialogDescription>Every publish is kept, and so are the copies you save. Restoring copies one into your draft; the store changes only when you publish.</DialogDescription>
          </DialogHeader>
          {canManage && <CheckpointForm documentId={documentId} count={checkpoints} flush={flush} />}
          {versions.isPending ? (
            <LoadingState rows={3} label="Loading versions" />
          ) : versions.error ? (
            <ErrorState title="Could not load the versions" error={versions.error} onRetry={() => void versions.refetch()} />
          ) : entries.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Nothing published or saved yet. Your first publish appears here.</p>
          ) : (
            <ul className="max-h-[55vh] divide-y overflow-y-auto" aria-label="Versions and saved copies">
              {entries.map((entry) => {
                const live = entry.kind === 'version' && entry.id === liveVersionId
                const title = entryTitle(entry)
                const numbered = entry.kind === 'version' && entry.number !== null
                const subject = numbered ? `version ${entry.number}` : `the saved copy “${title}”`
                return (
                  <li key={entry.id} className="flex flex-wrap items-center gap-3 py-3" data-testid={numbered ? `version-${entry.number}` : `checkpoint-${entry.id}`}>
                    <div className="min-w-0 flex-1">
                      {renaming === entry.id ? (
                        <RenameForm entry={entry} documentId={documentId} onDone={() => setRenaming(null)} />
                      ) : (
                        <p className="flex flex-wrap items-center gap-2 font-medium">
                          <span className="break-words">{title}</span>
                          {live && <Badge variant="success">Live</Badge>}
                          {entry.kind === 'checkpoint' && <Badge variant="soft">Saved copy · not published</Badge>}
                          {entry.via === 'scheduled' && (
                            <Badge variant="info">
                              <CalendarClockIcon aria-hidden /> Published on schedule
                            </Badge>
                          )}
                          {entry.via === 'review' && (
                            <Badge variant="info">
                              <ClipboardCheckIcon aria-hidden /> Approved
                            </Badge>
                          )}
                          {canManage && (
                            <Button type="button" variant="ghost" size="icon-sm" aria-label={`Rename ${subject}`} title="Rename" onClick={() => setRenaming(entry.id)}>
                              <PencilIcon />
                            </Button>
                          )}
                        </p>
                      )}
                      <p className="text-sm text-muted-foreground">
                        {entry.name && numbered && `Version ${entry.number} · `}
                        {formatStoreTime(entry.published_at ?? entry.created_at, timeZone)}
                        {entry.created_by?.name && ` · ${entry.created_by.name}`}
                      </p>
                      {entry.note && <p className="mt-0.5 text-sm">{entry.note}</p>}
                    </div>
                    <div className="flex flex-wrap items-center gap-1">
                      {live && liveUrl && (
                        <Button variant="outline" size="sm" asChild>
                          <a href={liveUrl} target="_blank" rel="noopener noreferrer" aria-label={`View version ${entry.number} on your store (opens in a new tab)`}>
                            <ExternalLinkIcon aria-hidden /> View
                          </a>
                        </Button>
                      )}
                      {compare && (
                        <Button
                          variant="outline"
                          size="sm"
                          aria-label={`Compare ${subject} with your draft`}
                          onClick={() => {
                            void flush?.()
                            setComparing({ left: entry.id, right: 'draft' })
                          }}
                        >
                          <ColumnsIcon aria-hidden /> Compare
                        </Button>
                      )}
                      {canRestore && (
                        <Button variant="outline" size="sm" onClick={() => setRestoring(entry)} aria-label={`Restore ${restoreLabel(entry)} to the draft`}>
                          Restore to draft
                        </Button>
                      )}
                      {canManage && entry.kind === 'checkpoint' && (
                        <Button variant="ghost" size="icon-sm" aria-label={`Delete ${subject}`} title="Delete this saved copy" onClick={() => setDeleting(entry)}>
                          <Trash2Icon />
                        </Button>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </DialogContent>
      </Dialog>
      {compare && comparing && (
        <CompareDialog
          documentId={documentId}
          entries={entries}
          liveVersionId={liveVersionId}
          initial={comparing}
          support={compare}
          canRestore={canRestore}
          onRestore={(entry) => setRestoring(entry)}
          onClose={() => setComparing(null)}
        />
      )}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(next) => !next && setDeleting(null)}
        title={`Delete the saved copy “${deleting ? entryTitle(deleting) : ''}”?`}
        description="Only this saved copy is deleted. Your draft and your shop stay as they are."
        confirmLabel="Delete"
        pending={busy}
        onConfirm={() => {
          if (!deleting) return
          setBusy(true)
          void deleteCheckpoint(documentId, deleting.id)
            .then(() => {
              toast.success('Saved copy deleted.')
              return queryClient.invalidateQueries({ queryKey: publishingKeys.versions(documentId) })
            })
            .catch((error: unknown) => toast.error(error instanceof Error ? error.message : 'It couldn’t be deleted.'))
            .finally(() => {
              setBusy(false)
              setDeleting(null)
            })
        }}
      />
      <ConfirmDialog
        open={restoring !== null}
        onOpenChange={(next) => !next && setRestoring(null)}
        title={`Restore ${restoring ? restoreLabel(restoring) : ''} to your draft?`}
        description="Your current draft is replaced by it (undo history is cleared). Nothing changes on the store until you publish."
        confirmLabel="Restore"
        pending={busy}
        onConfirm={() => {
          if (!restoring) return
          setBusy(true)
          void onRestore(restoring).finally(() => {
            setBusy(false)
            setRestoring(null)
            setComparing(null)
          })
        }}
      />
    </>
  )
}

/* ---------------------------------------------------------------- compare ------------------- */

function sideName(side: CompareSide, entries: VersionEntry[], liveVersionId: string | null): string {
  if (side === 'draft') return 'Your draft'
  if (side === 'live') return 'Live now'
  const entry = entries.find((e) => e.id === side)
  if (!entry) return 'Version'
  const live = entry.id === liveVersionId ? ' (live)' : ''
  return entry.kind === 'version' && entry.number !== null && entry.name ? `${entry.name} · Version ${entry.number}${live}` : `${entryTitle(entry)}${live}`
}

/** The render payload of one side: the editor's draft, the live version or a version / copy. */
function useSide(documentId: string, side: CompareSide, draft: () => RenderPayload): Side {
  const query = useQuery({
    queryKey: publishingKeys.render(documentId, side),
    queryFn: ({ signal }) => (side === 'live' ? fetchLiveRender(documentId, signal) : fetchVersionRender(documentId, side, signal)),
    enabled: side !== 'draft',
    staleTime: 5 * 60_000,
  })
  const [draftPayload] = useState(draft)
  if (side === 'draft') return { status: 'ready', payload: draftPayload }
  if (query.isPending) return { status: 'loading' }
  if (query.error) return { status: 'error', error: query.error, retry: () => void query.refetch() }
  if (query.data === null) return { status: 'empty', text: 'Not live yet: shoppers don’t see this page.' }
  return { status: 'ready', payload: query.data }
}

function SidePicker({ label, value, onChange, entries, liveVersionId }: { label: string; value: CompareSide; onChange: (value: CompareSide) => void; entries: VersionEntry[]; liveVersionId: string | null }) {
  const id = useId()
  return (
    <div className="flex items-center gap-2">
      <Label htmlFor={id} className="text-sm whitespace-nowrap">
        {label}
      </Label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 max-w-64 min-w-0 rounded-md border bg-transparent px-2 text-sm shadow-xs outline-none focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
      >
        <option value="draft">Your draft</option>
        {liveVersionId && <option value="live">Live now</option>}
        {entries.map((entry) => (
          <option key={entry.id} value={entry.id}>
            {sideName(entry.id, entries, liveVersionId)}
            {entry.kind === 'checkpoint' ? ' — saved copy' : ''}
          </option>
        ))}
      </select>
    </div>
  )
}

function CompareDialog({ documentId, entries, liveVersionId, initial, support, canRestore, onRestore, onClose }: {
  documentId: string
  entries: VersionEntry[]
  liveVersionId: string | null
  initial: { left: CompareSide; right: CompareSide }
  support: CompareSupport
  canRestore: boolean
  onRestore: (entry: VersionEntry) => void
  onClose: () => void
}) {
  const [left, setLeft] = useState(initial.left)
  const [right, setRight] = useState(initial.right)
  const leftSide = useSide(documentId, left, support.draft)
  const rightSide = useSide(documentId, right, support.draft)
  const changes = useQuery({
    queryKey: publishingKeys.compare(documentId, left, right),
    queryFn: ({ signal }) => fetchCompare(documentId, left, right, signal),
    enabled: left !== right,
    staleTime: 0,
  })
  const changesState: ChangesState =
    left === right
      ? { status: 'ready', result: { added: [], removed: [], changed: [], moved: [], device_moved: [] } }
      : changes.isPending
        ? { status: 'loading' }
        : changes.error
          ? { status: 'error', error: changes.error, retry: () => void changes.refetch() }
          : { status: 'ready', result: changes.data }
  const restorable = entries.find((e) => e.id === left) ?? null

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent showCloseButton={false} className="flex h-[100dvh] w-screen max-w-none flex-col gap-0 rounded-none p-0 sm:max-w-none" data-testid="compare-dialog">
        <DialogHeader className="flex flex-row flex-wrap items-center gap-3 border-b px-4 py-2">
          <DialogTitle className="mr-auto flex items-center gap-2 text-base">
            <ColumnsIcon className="size-5" aria-hidden /> Compare
          </DialogTitle>
          <DialogDescription className="sr-only">Two versions next to each other, with the list of what changed. Nothing here changes your page.</DialogDescription>
          <SidePicker label="Before" value={left} onChange={setLeft} entries={entries} liveVersionId={liveVersionId} />
          <SidePicker label="After" value={right} onChange={setRight} entries={entries} liveVersionId={liveVersionId} />
          {canRestore && restorable && (
            <Button type="button" variant="outline" size="sm" onClick={() => onRestore(restorable)}>
              Restore “Before” to the draft
            </Button>
          )}
          <Button type="button" variant="ghost" size="icon-sm" aria-label="Close compare" onClick={onClose}>
            <XIcon />
          </Button>
        </DialogHeader>
        <SideBySide
          bootstrap={support.bootstrap}
          surroundings={support.surroundings}
          emptyText={support.emptyText}
          theme={support.theme}
          typeLabel={support.typeLabel}
          left={{ title: <span className="truncate">Before: {sideName(left, entries, liveVersionId)}</span>, label: `Before: ${sideName(left, entries, liveVersionId)}`, side: leftSide }}
          right={{ title: <span className="truncate">After: {sideName(right, entries, liveVersionId)}</span>, label: `After: ${sideName(right, entries, liveVersionId)}`, side: rightSide }}
          changes={changesState}
        />
      </DialogContent>
    </Dialog>
  )
}
