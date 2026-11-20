import { useEffect, useId, useRef, useState } from 'react'
import { CheckIcon, EllipsisIcon, FileTextIcon, Loader2Icon, MapPinIcon, MapPinOffIcon, MessageSquarePlusIcon, PencilIcon, ReplyIcon, RotateCcwIcon, Trash2Icon, XIcon } from 'lucide-react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { ErrorState, LoadingState } from '@/components/common/state-views'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { ApiError } from '@/lib/api/client'
import { cn } from '@/lib/utils'
import { formatStoreTime } from '../publishing/schedule-time'
import { COMMENT_MAX, createComment, deleteComment, editComment, resolveComment, type BuilderComment, type Person } from './collab-api'
import { avatarColor, canStillEdit, initials, isOpen, mentionedIds, mentionParts } from './collab-model'
import { MentionTextarea } from './mention-textarea'
import type { CommentsUi } from './use-comments'

/*
 * B16 Comments panel (in place of the left panel while open): the threads pinned on the page with
 * reply, resolve / reopen, edit (the author, 15 minutes) and delete (the author or a publisher),
 * @mentions, an Open / Resolved filter, and the form for a new comment. Selecting a thread selects
 * and shows its part of the page. Comments are for the team only — shoppers never see them.
 */

type Props = {
  ui: CommentsUi
  documentId: string
  /** A part's name ("Heading: Fresh today"); null when it is no longer on the page. */
  labelOf: (nodeId: string) => string | null
  /** Selects and scrolls to a part of the page. */
  onShowNode: (nodeId: string) => void
  /** The selected part (for "Comment on the selected part"). */
  selection: { id: string; label: string } | null
  timeZone?: string
  /** Saves the latest changes first (a new part must be saved before it can be commented on). */
  flush?: () => Promise<boolean>
  onClose: () => void
}

function errorText(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    if (error.code === 'COMMENT_EDIT_CLOSED') return 'A comment can be changed for 15 minutes after it is posted. Add a reply instead.'
    if (error.code === 'COMMENT_NOT_YOURS') return 'Only the person who wrote a comment can change it.'
    if (error.code === 'NODE_NOT_FOUND') return 'That part is no longer on the page. Save the page first, or comment on the whole page.'
  }
  return error instanceof Error ? error.message : fallback
}

function Avatar({ person }: { person: Person | null }) {
  return (
    <span aria-hidden className={cn('flex size-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white', person ? avatarColor(person.id) : 'bg-neutral-600')}>
      {initials(person?.name ?? '?')}
    </span>
  )
}

function Body({ comment }: { comment: BuilderComment }) {
  return (
    <p className="text-sm break-words whitespace-pre-wrap">
      {mentionParts(comment.body, comment.mentions).map((part, i) =>
        part.mention ? (
          <span key={i} className="rounded-sm bg-blue-100 px-0.5 font-medium text-blue-900 dark:bg-blue-950 dark:text-blue-100">
            {part.text}
          </span>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </p>
  )
}

/** The form for a new comment, a reply or a change. */
function Composer({ label, initial = '', submitLabel, onSend, onCancel, autoFocus = true, testId }: {
  label: string
  initial?: string
  submitLabel: string
  onSend: (body: string, mentions: string[]) => Promise<void>
  onCancel?: () => void
  autoFocus?: boolean
  testId?: string
}) {
  const [value, setValue] = useState(initial)
  const [picked, setPicked] = useState<Person[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const hintId = useId()
  const send = async () => {
    const body = value.trim()
    if (!body) {
      setError('Write something first.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await onSend(body, mentionedIds(body, picked))
      setValue('')
      setPicked([])
    } catch (e) {
      setError(errorText(e, 'The comment could not be saved.'))
    } finally {
      setBusy(false)
    }
  }
  return (
    <form
      className="flex flex-col gap-1.5"
      onSubmit={(e) => {
        e.preventDefault()
        void send()
      }}
      noValidate
    >
      <MentionTextarea
        value={value}
        onChange={(next) => {
          setValue(next)
          setError(null)
        }}
        onPick={(person) => setPicked((list) => (list.some((p) => p.id === person.id) ? list : [...list, person]))}
        onSubmit={() => void send()}
        onCancel={onCancel}
        label={label}
        placeholder="Write a comment. Type @ to mention someone."
        autoFocus={autoFocus}
        describedBy={error ? `${hintId} ${hintId}-error` : hintId}
        invalid={error !== null}
        testId={testId}
      />
      <p id={hintId} className="flex justify-between gap-2 text-xs text-muted-foreground">
        <span>Ctrl+Enter sends. Only your team sees comments.</span>
        <span className="tabular-nums" aria-hidden>
          {value.length}/{COMMENT_MAX}
        </span>
      </p>
      {error && (
        <p id={`${hintId}-error`} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={busy}>
          {busy && <Loader2Icon className="animate-spin" aria-hidden />} {submitLabel}
        </Button>
        {onCancel && (
          <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  )
}

function CommentRow({ comment, documentId, timeZone, onChanged, onDelete, reply }: {
  comment: BuilderComment
  documentId: string
  timeZone?: string
  onChanged: () => Promise<void>
  onDelete: (comment: BuilderComment) => void
  reply: boolean
}) {
  const [editing, setEditing] = useState(false)
  const editable = canStillEdit(comment)
  const name = comment.author?.name ?? 'Someone who left the team'
  return (
    <div className={cn('flex gap-2', reply && 'mt-2 border-l-2 pl-2')} data-testid={`comment-${comment.id}`}>
      <Avatar person={comment.author} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="flex flex-wrap items-baseline gap-x-1.5 text-xs text-muted-foreground">
          <span className="font-semibold text-foreground">{name}</span>
          <span>{formatStoreTime(comment.created_at, timeZone, { short: true })}</span>
          {comment.edited_at && <span>(edited)</span>}
        </p>
        {editing ? (
          <Composer
            label={`Change your ${reply ? 'reply' : 'comment'}`}
            initial={comment.body}
            submitLabel="Save"
            onCancel={() => setEditing(false)}
            onSend={async (body, mentions) => {
              await editComment(documentId, comment.id, body, mentions)
              setEditing(false)
              await onChanged()
            }}
          />
        ) : (
          <Body comment={comment} />
        )}
      </div>
      {!editing && (editable || comment.can_delete) && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost" size="icon-sm" aria-label={`More actions for the ${reply ? 'reply' : 'comment'} by ${name}`}>
              <EllipsisIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {editable && (
              <DropdownMenuItem onSelect={() => setEditing(true)}>
                <PencilIcon /> Edit
              </DropdownMenuItem>
            )}
            {comment.can_delete && (
              <DropdownMenuItem variant="destructive" onSelect={() => onDelete(comment)}>
                <Trash2Icon /> Delete
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  )
}

function Thread({ thread, number, active, documentId, label, timeZone, onActivate, onShowNode, onChanged, onDelete }: {
  thread: BuilderComment
  number: number
  active: boolean
  documentId: string
  label: string | null
  timeZone?: string
  onActivate: () => void
  onShowNode: (nodeId: string) => void
  onChanged: () => Promise<void>
  onDelete: (comment: BuilderComment) => void
}) {
  const [replying, setReplying] = useState(false)
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLElement>(null)
  const titleId = useId()
  const open = isOpen(thread)
  const removed = thread.node_id !== null && (thread.node_removed || label === null)
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: 'nearest' })
  }, [active])
  const toggleResolved = async () => {
    setBusy(true)
    try {
      await resolveComment(documentId, thread.id, open)
      toast.success(open ? 'Resolved. Find it under “Resolved”.' : 'Opened again.')
      await onChanged()
    } catch (error) {
      toast.error(errorText(error, 'That didn’t work. Try again.'))
    } finally {
      setBusy(false)
    }
  }
  return (
    <article
      ref={ref}
      aria-labelledby={titleId}
      data-testid={`comment-thread-${thread.id}`}
      data-active={active || undefined}
      className={cn('flex flex-col gap-2 rounded-md border p-3', active && 'border-blue-600 ring-2 ring-blue-600/30', !open && 'bg-muted/40')}
      onFocusCapture={onActivate}
      onClick={onActivate}
    >
      <h3 id={titleId} className="flex flex-wrap items-center gap-2 text-xs">
        <span className={cn('flex size-5 items-center justify-center rounded-full text-[11px] font-bold', open ? 'bg-blue-700 text-white' : 'bg-muted-foreground/30 text-foreground')} aria-label={`Comment ${number}`}>
          {number}
        </span>
        {thread.node_id === null ? (
          <span className="flex items-center gap-1 text-muted-foreground">
            <FileTextIcon className="size-3.5" aria-hidden /> On the whole page
          </span>
        ) : removed ? (
          <span className="flex items-center gap-1 text-muted-foreground" data-testid="comment-removed-part">
            <MapPinOffIcon className="size-3.5" aria-hidden /> On a removed part
          </span>
        ) : (
          <button
            type="button"
            className="flex min-w-0 items-center gap-1 truncate text-left text-muted-foreground underline-offset-2 hover:underline focus-visible:underline"
            onClick={(e) => {
              e.stopPropagation()
              onActivate()
              if (thread.node_id) onShowNode(thread.node_id)
            }}
            aria-label={`Show on the page: ${label}`}
          >
            <MapPinIcon className="size-3.5 shrink-0" aria-hidden /> <span className="truncate">{label}</span>
          </button>
        )}
        {!open && (
          <Badge variant="soft" className="ml-auto">
            <CheckIcon aria-hidden /> Resolved{thread.resolved_by ? ` by ${thread.resolved_by.name}` : ''}
          </Badge>
        )}
      </h3>
      <CommentRow comment={thread} documentId={documentId} timeZone={timeZone} onChanged={onChanged} onDelete={onDelete} reply={false} />
      {thread.replies.map((reply) => (
        <CommentRow key={reply.id} comment={reply} documentId={documentId} timeZone={timeZone} onChanged={onChanged} onDelete={onDelete} reply />
      ))}
      {replying ? (
        <Composer
          label={`Reply to comment ${number}`}
          submitLabel="Reply"
          onCancel={() => setReplying(false)}
          testId={`reply-box-${thread.id}`}
          onSend={async (body, mentions) => {
            await createComment(documentId, { body, parent_id: thread.id, mentions })
            setReplying(false)
            await onChanged()
          }}
        />
      ) : (
        <div className="flex flex-wrap gap-1">
          <Button type="button" size="sm" variant="ghost" onClick={() => setReplying(true)} aria-label={`Reply to comment ${number}`}>
            <ReplyIcon data-icon="inline-start" /> Reply
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => void toggleResolved()} disabled={busy} aria-label={`${open ? 'Resolve' : 'Reopen'} comment ${number}`}>
            {busy ? <Loader2Icon className="animate-spin" aria-hidden /> : open ? <CheckIcon data-icon="inline-start" /> : <RotateCcwIcon data-icon="inline-start" />} {open ? 'Resolve' : 'Reopen'}
          </Button>
        </div>
      )}
    </article>
  )
}

export function CommentsPanel({ ui, documentId, labelOf, onShowNode, selection, timeZone, flush, onClose }: Props) {
  const headingRef = useRef<HTMLHeadingElement>(null)
  const [deleting, setDeleting] = useState<BuilderComment | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  // The heading gets the focus when the panel opens (not when it opens on a thread or a new comment).
  const [focusHeading] = useState(() => !ui.activeId && !ui.draft)
  useEffect(() => {
    if (focusHeading) headingRef.current?.focus()
  }, [focusHeading])
  const shown = ui.threads.filter((t) => (ui.filter === 'open' ? isOpen(t) : !isOpen(t))).sort((a, b) => (ui.numbers.get(a.id) ?? 0) - (ui.numbers.get(b.id) ?? 0))
  const draft = ui.draft
  const draftLabel = draft?.nodeId ? (labelOf(draft.nodeId) ?? 'a part of the page') : null

  return (
    <section aria-labelledby="comments-title" className="flex min-h-0 flex-1 flex-col" data-testid="comments-panel">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <h2 id="comments-title" ref={headingRef} tabIndex={-1} className="flex-1 text-sm font-semibold outline-none">
          Comments
        </h2>
        <Button type="button" variant="ghost" size="icon-sm" aria-label="Close comments" title="Close" onClick={onClose}>
          <XIcon />
        </Button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 py-3">
        <p className="text-sm text-muted-foreground">Leave notes for your team on any part of the page. Shoppers never see them.</p>
        <div className="flex flex-col gap-2">
          <Button type="button" variant={ui.mode ? 'secondary' : 'outline'} size="sm" aria-pressed={ui.mode} onClick={() => ui.setMode(!ui.mode)} data-testid="comment-mode-button">
            <MessageSquarePlusIcon data-icon="inline-start" /> {ui.mode ? 'Stop adding comments' : 'Add a comment on the page'}
          </Button>
          {ui.mode && (
            <p role="status" className="rounded-md bg-blue-50 p-2 text-xs text-blue-950 dark:bg-blue-950 dark:text-blue-50">
              Click the part of the page you want to comment on. Press Esc to stop.
            </p>
          )}
          {selection && !draft && (
            <Button type="button" variant="ghost" size="sm" className="justify-start" onClick={() => ui.startDraft({ nodeId: selection.id, anchor: null })} aria-keyshortcuts="C">
              <MapPinIcon data-icon="inline-start" /> <span className="truncate">Comment on “{selection.label}”</span>
              <kbd className="ml-auto rounded border px-1 text-[10px] text-muted-foreground">C</kbd>
            </Button>
          )}
          {!draft && (
            <Button type="button" variant="ghost" size="sm" className="justify-start" onClick={() => ui.startDraft({ nodeId: null, anchor: null })}>
              <FileTextIcon data-icon="inline-start" /> Comment on the whole page
            </Button>
          )}
        </div>
        {draft && (
          <div className="flex flex-col gap-2 rounded-md border border-blue-600 p-3" data-testid="comment-draft">
            <p className="text-xs font-medium">{draftLabel ? <>New comment on “{draftLabel}”</> : 'New comment on the whole page'}</p>
            <Composer
              label={draftLabel ? `Comment on ${draftLabel}` : 'Comment on the whole page'}
              submitLabel="Comment"
              onCancel={ui.cancelDraft}
              testId="new-comment-box"
              onSend={async (body, mentions) => {
                if (draft.nodeId && flush) await flush()
                const created = await createComment(documentId, { body, node_id: draft.nodeId, anchor: draft.anchor, mentions })
                ui.cancelDraft()
                await ui.refresh()
                if (created) ui.setActiveId(created.id)
                toast.success(mentions.length > 0 ? 'Comment added. The people you mentioned get a notification.' : 'Comment added.')
              }}
            />
          </div>
        )}
        <div role="group" aria-label="Show comments" className="grid grid-cols-2 gap-1 rounded-md border p-0.5">
          {(['open', 'resolved'] as const).map((value) => (
            <Button key={value} type="button" size="sm" variant={ui.filter === value ? 'secondary' : 'ghost'} aria-pressed={ui.filter === value} onClick={() => ui.setFilter(value)} className="h-7">
              {value === 'open' ? `Open (${ui.openCount})` : `Resolved (${ui.resolvedCount})`}
            </Button>
          ))}
        </div>
        {ui.loading ? (
          <LoadingState rows={2} label="Loading comments" />
        ) : ui.error ? (
          <ErrorState title="Could not load the comments" error={ui.error} onRetry={ui.retry} />
        ) : shown.length === 0 ? (
          <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground" data-testid="comments-empty">
            {ui.filter === 'open' ? 'No open comments. Add one to ask a question or suggest a change.' : 'No resolved comments yet.'}
          </p>
        ) : (
          <ul className="flex flex-col gap-2" aria-label={ui.filter === 'open' ? 'Open comments' : 'Resolved comments'}>
            {shown.map((thread) => (
              <li key={thread.id}>
                <Thread
                  thread={thread}
                  number={ui.numbers.get(thread.id) ?? 0}
                  active={ui.activeId === thread.id}
                  documentId={documentId}
                  label={thread.node_id ? labelOf(thread.node_id) : null}
                  timeZone={timeZone}
                  onActivate={() => {
                    if (ui.activeId === thread.id) return
                    ui.setActiveId(thread.id)
                    // Selecting a thread selects and shows its part of the page.
                    if (thread.node_id && !thread.node_removed && labelOf(thread.node_id) !== null) onShowNode(thread.node_id)
                  }}
                  onShowNode={onShowNode}
                  onChanged={ui.refresh}
                  onDelete={setDeleting}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(next) => !next && setDeleting(null)}
        title={deleting?.parent_id ? 'Delete this reply?' : 'Delete this comment?'}
        description={deleting?.parent_id ? 'The reply is removed for everyone.' : 'The comment and its replies are removed for everyone.'}
        confirmLabel="Delete"
        pending={deleteBusy}
        onConfirm={() => {
          if (!deleting) return
          setDeleteBusy(true)
          void deleteComment(documentId, deleting.id)
            .then(() => {
              toast.success('Deleted.')
              if (ui.activeId === deleting.id) ui.setActiveId(null)
              return ui.refresh()
            })
            .catch((error: unknown) => toast.error(errorText(error, 'It couldn’t be deleted.')))
            .finally(() => {
              setDeleteBusy(false)
              setDeleting(null)
            })
        }}
      />
    </section>
  )
}
