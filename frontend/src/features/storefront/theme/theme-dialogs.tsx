import { useState } from 'react'
import { HistoryIcon, Loader2Icon } from 'lucide-react'
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
import { useThemeVersionsQuery, type ThemeVersion } from '@/features/storefront/api'

function formatWhen(iso: string | null | undefined): string {
  if (!iso) return ''
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

/** Publish the theme draft with an optional note. */
export function ThemePublishDialog({ open, onOpenChange, pending, unsaved, onPublish }: { open: boolean; onOpenChange: (open: boolean) => void; pending: boolean; unsaved: boolean; onPublish: (note: string | null) => void }) {
  const [note, setNote] = useState('')
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return
        if (!next) setNote('')
        onOpenChange(next)
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Publish the theme?</DialogTitle>
          <DialogDescription>
            Shoppers see the new colours, fonts and layout right away. {unsaved && 'Your unsaved changes are saved first. '}The current look stays in the version history.
          </DialogDescription>
        </DialogHeader>
        <form
          id="theme-publish-form"
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            // Portalled, but React still bubbles the submit to the theme form around the dialog.
            e.stopPropagation()
            onPublish(note.trim() || null)
          }}
        >
          <Label htmlFor="theme-publish-note">Note (optional)</Label>
          <Textarea id="theme-publish-note" value={note} maxLength={160} rows={2} placeholder="What changed? e.g. Eid colours" onChange={(e) => setNote(e.target.value)} />
        </form>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="theme-publish-form" disabled={pending}>
            {pending && <Loader2Icon data-icon="inline-start" className="animate-spin" />}
            Publish
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** A save found that the draft changed elsewhere (409 DRAFT_CONFLICT). */
export function ThemeConflictDialog({ open, pending, onChoose }: { open: boolean; pending: boolean; onChoose: (choice: 'theirs' | 'mine') => void }) {
  return (
    <AlertDialog open={open}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>The theme draft changed in another tab or by someone else</AlertDialogTitle>
          <AlertDialogDescription>Your changes were not saved. Load their version (your unsaved changes are lost), or keep yours and save them over theirs.</AlertDialogDescription>
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

/** Every published theme; restoring copies one into the draft. */
export function ThemeVersionsDialog({ open, onOpenChange, liveNumber, canRestore, onRestore }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  liveNumber: number | null
  canRestore: boolean
  onRestore: (version: ThemeVersion) => Promise<void>
}) {
  const versions = useThemeVersionsQuery(open)
  const [restoring, setRestoring] = useState<ThemeVersion | null>(null)
  const [busy, setBusy] = useState(false)

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <HistoryIcon className="size-5" aria-hidden /> Theme history
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
            <ul className="max-h-[60vh] divide-y overflow-y-auto" aria-label="Published theme versions">
              {versions.data.map((version) => (
                <li key={version.id} className="flex flex-wrap items-center gap-3 py-3" data-testid={`theme-version-${version.number}`}>
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 font-medium">
                      Version {version.number}
                      {version.number === liveNumber && <Badge variant="success">Live</Badge>}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {formatWhen(version.published_at ?? version.created_at)}
                      {version.created_by?.name && ` · ${version.created_by.name}`}
                    </p>
                    {version.note && <p className="mt-0.5 text-sm">{version.note}</p>}
                  </div>
                  {canRestore && (
                    <Button variant="outline" size="sm" onClick={() => setRestoring(version)} aria-label={`Restore version ${version.number} to the draft`}>
                      Restore to draft
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={restoring !== null}
        onOpenChange={(next) => !next && !busy && setRestoring(null)}
        title={`Restore version ${restoring?.number ?? ''} to your draft?`}
        description="Your current draft (including unsaved changes) is replaced by this version. Nothing changes on the store until you publish."
        confirmLabel="Restore"
        destructive={false}
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
