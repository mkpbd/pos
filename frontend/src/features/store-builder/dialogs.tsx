import { useState } from 'react'
import { CircleAlertIcon, CircleCheckIcon, ExternalLinkIcon, HistoryIcon, Loader2Icon, TriangleAlertIcon } from 'lucide-react'
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useVersionsQuery, type VersionSummary } from './api'
import { formatDateTime } from './format'
import { ServerCheckNote } from './check-panel'
import type { PageCheck } from './use-page-check'
import { countsText } from './page-check'
import { safeLinkUrl } from './inline-edit'

/**
 * B10: the URL prompt of the canvas format bar's Link button. Answers a checked URL, '' (remove
 * the link) or null (cancelled — nothing changes).
 */
export function LinkPrompt({ request, onAnswer }: { request: { url: string | null } | null; onAnswer: (url: string | null) => void }) {
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [seen, setSeen] = useState<typeof request>(null)
  if (request !== seen) {
    setSeen(request)
    setValue(request?.url ?? '')
    setError(null)
  }
  const save = () => {
    const url = safeLinkUrl(value)
    if (!url) {
      setError('Use a page on your store (starting with /), a full address (https://…) or an e-mail link (mailto:…).')
      return
    }
    onAnswer(url)
  }
  return (
    <Dialog open={request !== null} onOpenChange={(open) => !open && onAnswer(null)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{request?.url ? 'Change the link' : 'Add a link'}</DialogTitle>
          <DialogDescription>The selected words link to this address.</DialogDescription>
        </DialogHeader>
        <form
          id="link-prompt-form"
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            save()
          }}
        >
          <Label htmlFor="link-prompt-url">Link address</Label>
          <Input
            id="link-prompt-url"
            value={value}
            maxLength={500}
            autoFocus
            spellCheck={false}
            placeholder="/shop or https://example.com"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'link-prompt-error' : undefined}
            onChange={(e) => {
              setValue(e.target.value)
              setError(null)
            }}
          />
          {error && (
            <p id="link-prompt-error" role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </form>
        <DialogFooter>
          {request?.url && (
            <Button type="button" variant="outline" className="sm:mr-auto" onClick={() => onAnswer('')}>
              Remove link
            </Button>
          )}
          <Button type="button" variant="outline" onClick={() => onAnswer(null)}>
            Cancel
          </Button>
          <Button type="submit" form="link-prompt-form">
            Save link
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** B10: the page check in the publish dialog: "N errors, M warnings", the errors highlighted; it never blocks publishing. */
function PublishCheck({ check, onShowAll }: { check: PageCheck; onShowAll?: () => void }) {
  const { counts, issues, server } = check
  const errors = issues.filter((i) => i.severity === 'error')
  const tone = counts.errors > 0 ? 'border-destructive/40 bg-destructive/5' : counts.warnings > 0 ? 'border-amber-500/40 bg-amber-500/5' : 'border-border bg-muted/40'
  const Icon = counts.errors > 0 ? CircleAlertIcon : counts.warnings > 0 ? TriangleAlertIcon : CircleCheckIcon
  return (
    <section aria-label="Page check" className={`flex flex-col gap-2 rounded-md border p-3 ${tone}`} data-testid="publish-check">
      <p className="flex items-center gap-2 text-sm font-medium" role="status" aria-live="polite">
        <Icon className={counts.errors > 0 ? 'size-4 text-destructive' : counts.warnings > 0 ? 'size-4 text-amber-700 dark:text-amber-400' : 'size-4 text-success'} aria-hidden />
        Page check: {countsText(counts)}
      </p>
      {errors.length > 0 && (
        <ul className="flex list-disc flex-col gap-1 pl-6 text-sm text-destructive" aria-label="Errors">
          {errors.slice(0, 3).map((issue) => (
            <li key={issue.key}>{issue.message}</li>
          ))}
          {errors.length > 3 && <li className="list-none">…and {errors.length - 3} more.</li>}
        </ul>
      )}
      <ServerCheckNote server={server} onRetry={() => void check.runServer()} />
      {counts.errors > 0 && <p className="text-xs text-muted-foreground">You can still publish — errors make the page harder to use for some shoppers.</p>}
      {onShowAll && counts.total > 0 && (
        <Button type="button" variant="link" size="sm" className="h-auto w-fit p-0" onClick={onShowAll}>
          Show all in Check page
        </Button>
      )}
    </section>
  )
}

/** Publish with an optional note; `error` explains why it cannot (problems, empty page). */
export function PublishDialog({ open, onOpenChange, pending, error, onPublish, popup = false, usedOn = null, check, onShowCheck }: { open: boolean; onOpenChange: (open: boolean) => void; pending: boolean; error: string | null; onPublish: (note: string | null) => void; popup?: boolean; /** B9: a global section — how many pages show it. */ usedOn?: number | null; /** B10: the page check (summary above the note). */ check?: PageCheck; /** B10: opens the Check page panel. */ onShowCheck?: () => void }) {
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
          <DialogTitle>{usedOn !== null ? 'Publish this global section?' : popup ? 'Publish this popup?' : 'Publish this page?'}</DialogTitle>
          <DialogDescription>
            {usedOn !== null
              ? `Every page that uses it${usedOn > 0 ? ` (${usedOn})` : ''} shows this version right away. Earlier versions stay in the version history.`
              : popup
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
          {check && <PublishCheck check={check} onShowAll={onShowCheck} />}
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
            {check && check.counts.errors > 0 ? 'Publish anyway' : 'Publish'}
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
