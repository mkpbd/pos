import { CopyIcon, EyeIcon, HandIcon, Loader2Icon, LockOpenIcon, UndoDotIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { Viewer } from './collab-api'
import { avatarColor, initials } from './collab-model'
import type { PresenceUi } from './use-presence'

/*
 * B16: who else has this page open (toolbar avatars) and the banner while someone else edits it.
 */

const MAX_AVATARS = 4

export function PresenceAvatars({ viewers }: { viewers: Viewer[] }) {
  if (viewers.length === 0) return null
  const shown = viewers.slice(0, MAX_AVATARS)
  const more = viewers.length - shown.length
  const label = viewers.map((v) => `${v.user.name} (${v.editing ? 'editing' : 'viewing'})`).join(', ')
  return (
    <ul className="flex items-center -space-x-1.5" aria-label={`Also on this page: ${label}`} data-testid="presence-avatars">
      {shown.map((viewer) => (
        <li key={viewer.user.id} className="list-none">
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                tabIndex={0}
                data-testid={`presence-${viewer.user.id}`}
                aria-label={`${viewer.user.name}, ${viewer.editing ? 'editing' : 'viewing'}`}
                className={cn(
                  'relative flex size-7 items-center justify-center rounded-full border-2 border-background text-[11px] font-semibold text-white outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  avatarColor(viewer.user.id),
                  viewer.editing && 'ring-2 ring-amber-500',
                )}
              >
                <span aria-hidden>{initials(viewer.user.name)}</span>
                {viewer.editing && <span aria-hidden className="absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full border border-background bg-amber-500" />}
              </span>
            </TooltipTrigger>
            <TooltipContent>
              {viewer.user.name} · {viewer.editing ? 'editing' : 'viewing'}
            </TooltipContent>
          </Tooltip>
        </li>
      ))}
      {more > 0 && (
        <li className="list-none">
          <span className="flex size-7 items-center justify-center rounded-full border-2 border-background bg-muted text-[11px] font-semibold text-foreground" title={label}>
            +{more}
          </span>
        </li>
      )}
    </ul>
  )
}

/** The banner under the toolbar: someone else edits (read-only), or our earlier unsaved changes. */
export function PresenceBanner({ ui }: { ui: PresenceUi }) {
  if (ui.readOnly) {
    const name = ui.editor?.name ?? 'Someone else'
    return (
      <div role="status" data-testid="presence-banner" className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-50">
        <EyeIcon className="size-4 shrink-0" aria-hidden />
        <p className="min-w-0 flex-1">
          <strong className="font-semibold">{name} is editing this page.</strong> You can look and comment.
          {ui.stash && ' Your changes that weren’t saved are kept on this computer.'}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {ui.stash && (
            <Button type="button" size="sm" variant="outline" onClick={ui.copyMyChanges}>
              <CopyIcon data-icon="inline-start" /> Copy my changes
            </Button>
          )}
          <Button type="button" size="sm" variant="outline" onClick={() => void ui.askToEdit()} disabled={ui.pending !== null}>
            {ui.pending === 'ask' ? <Loader2Icon className="animate-spin" aria-hidden /> : <HandIcon data-icon="inline-start" />} Ask to edit
          </Button>
          {ui.canTakeOver && (
            <Button type="button" size="sm" onClick={() => void ui.takeOver()} disabled={ui.pending !== null}>
              {ui.pending === 'take-over' ? <Loader2Icon className="animate-spin" aria-hidden /> : <LockOpenIcon data-icon="inline-start" />} Take over
            </Button>
          )}
        </div>
      </div>
    )
  }
  if (ui.stash) {
    return (
      <div role="status" data-testid="stash-banner" className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b bg-muted/60 px-4 py-2 text-sm">
        <UndoDotIcon className="size-4 shrink-0" aria-hidden />
        <p className="min-w-0 flex-1">
          Some of your changes weren’t saved because someone else was editing. They are kept on this computer. Putting them back replaces the page as it is now with your version — Undo brings it back.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" onClick={ui.putBack}>
            Put my changes back
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={ui.copyMyChanges}>
            <CopyIcon data-icon="inline-start" /> Copy them
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={ui.forgetStash}>
            Forget them
          </Button>
        </div>
      </div>
    )
  }
  return null
}
