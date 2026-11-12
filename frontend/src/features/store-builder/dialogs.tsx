import { useState } from 'react'
import { ExternalLinkIcon, HistoryIcon, Loader2Icon } from 'lucide-react'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { ErrorState, LoadingState } from '@/components/common/state-views'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useVersionsQuery, type VersionSummary } from './api'
import { formatDateTime } from './format'

/** Publish with an optional note; `error` explains why it cannot (problems, empty page). */
export function PublishDialog({ open, onOpenChange, pending, error, onPublish, popup = false }: { open: boolean; onOpenChange: (open: boolean) => void; pending: boolean; error: string | null; onPublish: (note: string | null) => void; popup?: boolean }) {
  const [note, setNote] = useState('')
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setNote('')
        onOpenChange(next)
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{popup ? 'Publish this popup?' : 'Publish this page?'}</DialogTitle>
          <DialogDescription>
            {popup
              ? 'Shoppers see this version while the popup is switched on. Earlier versions stay in the version history.'
              : 'Shoppers will see this version of the page right away. Earlier versions stay in the version history.'}
          </DialogDescription>
        </DialogHeader>
        <form
          id="publish-form"
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            onPublish(note.trim() || null)
          }}
        >
          <Label htmlFor="publish-note">Note (optional)</Label>
          <Textarea id="publish-note" value={note} maxLength={160} onChange={(e) => setNote(e.target.value)} placeholder="What changed? e.g. Eid sale banners" rows={2} />
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </form>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="publish-form" disabled={pending}>
            {pending && <Loader2Icon className="animate-spin" aria-hidden />}
            Publish
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** A save found that the draft changed elsewhere (409). */
export function ConflictDialog({ open, pending, onChoose }: { open: boolean; pending: boolean; onChoose: (choice: 'theirs' | 'mine') => void }) {
  return (
    <AlertDialog open={open}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>This page changed in another tab or by someone else</AlertDialogTitle>
          <AlertDialogDescription>
            Your latest changes were not saved. Load their version (your unsaved changes are lost), or keep yours and save them over theirs.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending} onClick={() => onChoose('theirs')}>
            Load their version
          </AlertDialogCancel>
          <AlertDialogAction disabled={pending} onClick={() => onChoose('mine')}>
            Keep mine
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/** Leaving the editor while a change is not saved. */
export function LeaveDialog({ open, onStay, onLeave }: { open: boolean; onStay: () => void; onLeave: () => void }) {
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(next) => !next && onStay()}
      title="Leave without saving?"
      description="Your latest changes could not be saved yet. If you leave now, they are lost."
      confirmLabel="Leave anyway"
      onConfirm={onLeave}
    />
  )
}

type VersionHistoryProps = {
  documentId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  liveVersionId: string | null
  /** The live page on the store, or null without a store address. */
  liveUrl: string | null
  canRestore: boolean
  onRestore: (version: VersionSummary) => Promise<void>
}

export function VersionHistoryDialog({ documentId, open, onOpenChange, liveVersionId, liveUrl, canRestore, onRestore }: VersionHistoryProps) {
  const versions = useVersionsQuery(documentId, open)
  const [restoring, setRestoring] = useState<VersionSummary | null>(null)
  const [busy, setBusy] = useState(false)

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <HistoryIcon className="size-5" aria-hidden /> Version history
            </DialogTitle>
            <DialogDescription>Every publish is kept. Restoring copies a version into your draft; the store changes only when you publish.</DialogDescription>
          </DialogHeader>
          {versions.isPending ? (
            <LoadingState rows={3} label="Loading versions" />
          ) : versions.error ? (
            <ErrorState title="Could not load the versions" error={versions.error} onRetry={() => void versions.refetch()} />
          ) : versions.data.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Nothing published yet. Your first publish appears here.</p>
          ) : (
            <ul className="max-h-[60vh] divide-y overflow-y-auto" aria-label="Published versions">
              {versions.data.map((version) => {
                const live = version.id === liveVersionId
                return (
                  <li key={version.id} className="flex flex-wrap items-center gap-3 py-3" data-testid={`version-${version.number}`}>
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-2 font-medium">
                        Version {version.number}
                        {live && <Badge variant="success">Live</Badge>}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {formatDateTime(version.published_at ?? version.created_at)}
                        {version.created_by?.name && ` · ${version.created_by.name}`}
                      </p>
                      {version.note && <p className="mt-0.5 text-sm">{version.note}</p>}
                    </div>
                    {live && liveUrl && (
                      <Button variant="outline" size="sm" asChild>
                        <a href={liveUrl} target="_blank" rel="noopener noreferrer" aria-label={`View version ${version.number} on your store (opens in a new tab)`}>
                          <ExternalLinkIcon aria-hidden /> View
                        </a>
                      </Button>
                    )}
                    {canRestore && (
                      <Button variant="outline" size="sm" onClick={() => setRestoring(version)} aria-label={`Restore version ${version.number} to the draft`}>
                        Restore to draft
                      </Button>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={restoring !== null}
        onOpenChange={(next) => !next && setRestoring(null)}
        title={`Restore version ${restoring?.number ?? ''} to your draft?`}
        description="Your current draft is replaced by this version (undo history is cleared). Nothing changes on the store until you publish."
        confirmLabel="Restore"
        pending={busy}
        onConfirm={() => {
          if (!restoring) return
          setBusy(true)
          void onRestore(restoring).finally(() => {
            setBusy(false)
            setRestoring(null)
          })
        }}
      />
    </>
  )
}
