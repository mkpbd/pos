import { useState } from 'react'
import { CircleAlertIcon, CircleCheckIcon, Loader2Icon, TriangleAlertIcon } from 'lucide-react'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
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
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { PublishWhenFields } from './publishing/publish-when'
import { usePublishWhen, type PublishLater } from './publishing/use-publish-when'
import { ServerCheckNote } from './check-panel'
import type { PageCheck } from './use-page-check'
import { countsText } from './page-check'
import { safeLinkUrl } from './inline-edit'
import { FirstPublishTip } from './easy/tips'

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

/**
 * Publish with an optional note; `error` explains why it cannot (problems, empty page). B11: with
 * `later`, "Publish now | Publish later" — later takes a date and time in the store's timezone and
 * puts the page live then, as it is now (./publishing/publish-when.tsx).
 */
export function PublishDialog({ open, onOpenChange, pending, error, onPublish, popup = false, usedOn = null, check, onShowCheck, later }: { open: boolean; onOpenChange: (open: boolean) => void; pending: boolean; error: string | null; onPublish: (note: string | null, options?: { cancelSchedule?: boolean }) => void; popup?: boolean; /** B9: a global section — how many pages show it. */ usedOn?: number | null; /** B10: the page check (summary above the note). */ check?: PageCheck; /** B10: opens the Check page panel. */ onShowCheck?: () => void; /** B11: offer "Publish later". */ later?: PublishLater }) {
  const [note, setNote] = useState('')
  const when = usePublishWhen(open, later)
  const noun = usedOn !== null ? 'global section' : popup ? 'popup' : 'page'

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
            {when.scheduling
              ? `The ${noun} goes live at the time you choose, exactly as it is now. Changes you make after this stay in your draft.`
              : usedOn !== null
              ? `Every page that uses it${usedOn > 0 ? ` (${usedOn})` : ''} shows this version right away. Earlier versions stay in the version history.`
              : popup
              ? 'Shoppers see this version while the popup is switched on. Earlier versions stay in the version history.'
              : 'Shoppers will see this version of the page right away. Earlier versions stay in the version history.'}
          </DialogDescription>
        </DialogHeader>
        <form
          id="publish-form"
          className="flex flex-col gap-2"
          noValidate
          onSubmit={(e) => {
            e.preventDefault()
            if (later && when.scheduling) {
              const iso = when.laterInstant()
              if (iso) later.onSchedule(iso, note.trim() || null)
              return
            }
            onPublish(note.trim() || null, when.nowOptions)
          }}
        >
          {/* B21: the first time, a one-line tip: Check page looks for problems first. */}
          <FirstPublishTip onShowCheck={onShowCheck} />
          <PublishWhenFields when={when} noun={noun} />
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
            {when.scheduling ? 'Schedule' : check && check.counts.errors > 0 ? 'Publish anyway' : 'Publish'}
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
