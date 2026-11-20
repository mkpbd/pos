import { useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { SamplePicker } from './template-sample'
import {
  ArrowLeftIcon,
  CircleAlertIcon,
  CloudOffIcon,
  EllipsisIcon,
  ExternalLinkIcon,
  HistoryIcon,
  Loader2Icon,
  MonitorIcon,
  Redo2Icon,
  RocketIcon,
  SmartphoneIcon,
  TabletIcon,
  Undo2Icon,
  UndoDotIcon,
  CheckIcon,
  ListChecksIcon,
  SendIcon,
  KeyboardIcon,
  SearchIcon,
  ChartColumnIcon,
  FlaskConicalIcon,
  LockIcon,
  MessageSquareIcon,
  DownloadIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuShortcut, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { Device } from '@/storefront/builder/types'
import { problemCount } from './autosave'
import { DEVICE_WIDTHS } from './canvas-config'
import { IS_MAC, useRelativeTime } from './format'
import { EDIT_LOCALES } from './inline-edit'
import { isDirty, useEditor, type SaveState } from './store'
import { PreviewAsMenu } from './audience/preview-as-menu'
import { PresenceAvatars } from './collab/presence-ui'
import type { Viewer } from './collab/collab-api'

const DEVICES: { device: Device; label: string; icon: typeof MonitorIcon }[] = [
  { device: 'desktop', label: 'Desktop', icon: MonitorIcon },
  { device: 'tablet', label: 'Tablet', icon: TabletIcon },
  { device: 'mobile', label: 'Mobile', icon: SmartphoneIcon },
]

const MOD = IS_MAC ? '⌘' : 'Ctrl'

function Hint({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

export function SaveStatus({ onShowProblem }: { onShowProblem: () => void }) {
  const saveState: SaveState = useEditor((s) => s.saveState)
  const dirty = useEditor(isDirty)
  const problems = useEditor((s) => problemCount(s.errors))
  const ago = useRelativeTime(saveState.savedAt)

  let body: ReactNode
  switch (saveState.status) {
    case 'saving':
      body = (
        <>
          <Loader2Icon className="size-3.5 animate-spin" aria-hidden /> Saving…
        </>
      )
      break
    case 'invalid':
      return (
        <div role="status" aria-live="polite">
          <Button type="button" variant="ghost" size="sm" className="text-destructive" onClick={onShowProblem} title="Show the first problem">
            <CircleAlertIcon aria-hidden /> Can’t save — {problems} {problems === 1 ? 'problem' : 'problems'}
          </Button>
        </div>
      )
    case 'offline':
      body = (
        <span className="flex items-center gap-1.5 text-warning-soft-foreground">
          <CloudOffIcon className="size-3.5" aria-hidden /> Offline — will retry
        </span>
      )
      break
    case 'conflict':
      body = (
        <span className="flex items-center gap-1.5 text-destructive">
          <CircleAlertIcon className="size-3.5" aria-hidden /> Not saved — changed elsewhere
        </span>
      )
      break
    case 'locked':
      body = (
        <span className="flex items-center gap-1.5 text-destructive">
          <LockIcon className="size-3.5" aria-hidden /> Not saved — someone else is editing
        </span>
      )
      break
    case 'error':
      body = (
        <span className="flex items-center gap-1.5 text-destructive" title={saveState.message}>
          <CircleAlertIcon className="size-3.5" aria-hidden /> Can’t save{saveState.message ? ` — ${saveState.message}` : ''}
        </span>
      )
      break
    default:
      body = dirty ? (
        <>Unsaved changes</>
      ) : (
        <>
          <CheckIcon className="size-3.5" aria-hidden /> {ago ? `Saved · ${ago}` : 'Saved'}
        </>
      )
  }
  return (
    <p role="status" aria-live="polite" data-testid="save-status" className="flex max-w-60 items-center gap-1.5 truncate px-2 text-xs text-muted-foreground">
      {body}
    </p>
  )
}

function TitleField({ title, canEdit, onRename }: { title: string; canEdit: boolean; onRename: (title: string) => Promise<void> }) {
  const [value, setValue] = useState(title)
  const [editing, setEditing] = useState(false)
  if (!editing && value !== title) setValue(title)

  const commit = () => {
    setEditing(false)
    const next = value.trim()
    if (!next || next === title) {
      setValue(title)
      return
    }
    void onRename(next.slice(0, 160)).catch(() => setValue(title))
  }

  if (!canEdit) return <h1 className="truncate text-sm font-semibold">{title}</h1>
  return (
    <Input
      aria-label="Page title"
      title="Rename this page"
      value={value}
      maxLength={160}
      onFocus={() => setEditing(true)}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape') {
          setValue(title)
          setEditing(false)
          requestAnimationFrame(() => (e.target as HTMLInputElement).blur())
        }
      }}
      className="h-8 w-56 border-transparent bg-transparent font-semibold shadow-none hover:border-input focus-visible:border-input"
    />
  )
}

type ToolbarProps = {
  canPublish: boolean
  /** B11: may edit but not publish — "Submit for review" instead of Publish. */
  canSubmit?: boolean
  onSubmitReview?: () => void
  /** B11: the planned publish and approval chips. */
  status?: ReactNode
  onRename: (title: string) => Promise<void>
  onPreview: () => void
  onPublish: () => void
  onDiscard: () => void
  onHistory: () => void
  onShowProblem: () => void
  /** B10: the store edits Bangla too: offer "Edit in: English | বাংলা". */
  bangla?: boolean
  /** B10: the page check's errors and warnings (the badge); absent = no Check page button. */
  check?: { errors: number; warnings: number; open: boolean; onToggle: () => void }
  /** B12: opens the command box (Ctrl/Cmd+K). */
  onCommandBox?: () => void
  /** B12: opens the keyboard shortcut sheet (?). */
  onShortcuts?: () => void
  /** B15: the Insights panel (pages only); absent = no Insights button. */
  insights?: { open: boolean; onToggle: () => void }
  /** B13: the A/B tests panel (page documents only; `count` = the document's tests); absent = no button. */
  abTests?: { open: boolean; count: number; onToggle: () => void }
  /** B13: "Preview as" a shopper (audiences); false = no control (e.g. compare screens). Default on. */
  previewAs?: boolean
  /** B14: show a store page design's "Preview with" sample picker (a flag, not an element: an inline element prop kept the React Compiler from optimizing the editor). */
  sample?: boolean
  /** B16: someone else is editing — undo, redo, renaming, publishing and discarding are off. */
  readOnly?: boolean
  /** B16: the other people on the page (avatars). */
  people?: Viewer[]
  /** B16: the Comments panel and the number of open comments; absent = no button. */
  comments?: { open: boolean; count: number; onToggle: () => void }
  /** B16: ⋯ "Download a copy (.json)"; absent = not offered. */
  onDownload?: () => void
}

/** B10: "Edit in: English | বাংলা" — the language the canvas shows and edits. */
function LocaleToggle() {
  const locale = useEditor((s) => s.editLocale)
  const setEditLocale = useEditor((s) => s.setEditLocale)
  const previewAs = useEditor((s) => s.previewAs)
  const setPreviewAs = useEditor((s) => s.setPreviewAs)
  // B13: a "Preview as" shopper reads the language the canvas shows.
  const setLocale = (value: 'en' | 'bn') => {
    setEditLocale(value)
    if (previewAs && previewAs.language !== value) setPreviewAs({ ...previewAs, language: value })
  }
  return (
    <div role="group" aria-label="Edit in" className="flex items-center gap-1 rounded-md border p-0.5" data-testid="edit-locale">
      <span className="hidden px-1.5 text-xs text-muted-foreground xl:inline" aria-hidden>
        Edit in
      </span>
      {EDIT_LOCALES.map(({ value, label, lang }) => (
        <Button
          key={value}
          type="button"
          size="sm"
          variant={locale === value ? 'secondary' : 'ghost'}
          className="h-7 px-2"
          lang={lang}
          aria-pressed={locale === value}
          title={value === 'bn' ? 'Show and edit the Bangla texts on the page (empty ones show English)' : 'Show and edit the English texts on the page'}
          onClick={() => setLocale(value)}
        >
          {label}
        </Button>
      ))}
    </div>
  )
}

export function Toolbar({ canPublish, canSubmit = false, onSubmitReview, status, onRename, onPreview, onPublish, onDiscard, onHistory, onShowProblem, bangla = false, check, onCommandBox, onShortcuts, insights, abTests, previewAs = true, sample, readOnly = false, people, comments, onDownload }: ToolbarProps) {
  const document = useEditor((s) => s.document)
  const device = useEditor((s) => s.device)
  const setDevice = useEditor((s) => s.setDevice)
  const canUndo = useEditor((s) => s.history.past.length > 0) && !readOnly
  const canRedo = useEditor((s) => s.history.future.length > 0) && !readOnly
  const undo = useEditor((s) => s.undo)
  const redo = useEditor((s) => s.redo)
  const isPopup = document.kind === 'popup'

  return (
    <header aria-label="Editor toolbar" className="flex h-14 shrink-0 items-center gap-2 border-b bg-background px-2">
      <Hint label="Back to your pages">
        <Button variant="ghost" size="icon" asChild>
          <Link to="/storefront/pages" aria-label="Back to pages">
            <ArrowLeftIcon />
          </Link>
        </Button>
      </Hint>
      <div className="flex min-w-0 flex-col">
        <TitleField title={document.title} canEdit={!readOnly} onRename={onRename} />
      </div>
      <span className="hidden truncate text-xs text-muted-foreground lg:inline">{document.path}</span>

      <div className="mx-auto flex items-center gap-1" role="group" aria-label="Canvas width">
        {DEVICES.map(({ device: value, label, icon: Icon }) => (
          <Hint key={value} label={`${label} (${DEVICE_WIDTHS[value]} px)`}>
            <Button type="button" variant={device === value ? 'secondary' : 'ghost'} size="icon" aria-pressed={device === value} aria-label={`${label} view`} onClick={() => setDevice(value)}>
              <Icon />
            </Button>
          </Hint>
        ))}
      </div>

      {people && people.length > 0 && <PresenceAvatars viewers={people} />}

      {bangla && <LocaleToggle />}
      {sample && <SamplePicker />}
      {previewAs && <PreviewAsMenu bangla={bangla} />}

      {onCommandBox && (
        <Hint label={`Find an element, a page or an action (${MOD}+K)`}>
          <Button type="button" variant="ghost" size="icon" aria-label="Find or do anything" aria-keyshortcuts={IS_MAC ? 'Meta+K' : 'Control+K'} onClick={onCommandBox} data-testid="command-box-button">
            <SearchIcon />
          </Button>
        </Hint>
      )}

      <div className="flex items-center gap-1">
        <Hint label={`Undo (${MOD}+Z)`}>
          <Button type="button" variant="ghost" size="icon" aria-label="Undo" disabled={!canUndo} onClick={undo}>
            <Undo2Icon />
          </Button>
        </Hint>
        <Hint label={`Redo (${MOD}+Shift+Z)`}>
          <Button type="button" variant="ghost" size="icon" aria-label="Redo" disabled={!canRedo} onClick={redo}>
            <Redo2Icon />
          </Button>
        </Hint>
      </div>

      <SaveStatus onShowProblem={onShowProblem} />
      {status}

      {insights && (
        <Hint label="How many people saw this page, where they clicked and what they ordered">
          <Button type="button" variant={insights.open ? 'secondary' : 'outline'} aria-pressed={insights.open} onClick={insights.onToggle} data-testid="insights-button">
            <ChartColumnIcon /> Insights
          </Button>
        </Hint>
      )}
      {comments && (
        <Hint label="Notes for your team on this page (C adds one on the selected part)">
          <Button type="button" variant={comments.open ? 'secondary' : 'outline'} aria-pressed={comments.open} onClick={comments.onToggle} data-testid="comments-button">
            <MessageSquareIcon /> <span className="hidden xl:inline">Comments</span>
            <span className="sr-only xl:hidden">Comments</span>
            {comments.count > 0 && (
              <span data-testid="comments-count" className="ml-0.5 rounded-full bg-blue-700 px-1.5 text-xs font-semibold text-white tabular-nums">
                <span aria-hidden>{comments.count}</span>
                <span className="sr-only">{`${comments.count} open`}</span>
              </span>
            )}
          </Button>
        </Hint>
      )}
      {abTests && (
        <Hint label="Try two versions of a section and see which one gets more orders">
          <Button type="button" variant={abTests.open ? 'secondary' : 'outline'} aria-pressed={abTests.open} onClick={abTests.onToggle} data-testid="ab-tests-button">
            <FlaskConicalIcon /> A/B tests
            {abTests.count > 0 && (
              <span data-testid="ab-tests-count" className="ml-0.5 rounded-full bg-primary px-1.5 text-xs font-semibold text-primary-foreground tabular-nums">
                <span aria-hidden>{abTests.count}</span>
                <span className="sr-only">{`${abTests.count} ${abTests.count === 1 ? 'test' : 'tests'}`}</span>
              </span>
            )}
          </Button>
        </Hint>
      )}
      {check && (
        <Hint label="Look for missing picture descriptions, hard-to-read text, broken links and more">
          <Button type="button" variant={check.open ? 'secondary' : 'outline'} aria-pressed={check.open} onClick={check.onToggle} data-testid="check-page-button">
            <ListChecksIcon /> Check page
            {check.errors + check.warnings > 0 && (
              <span
                data-testid="check-badge"
                className={cn('ml-0.5 rounded-full px-1.5 text-xs font-semibold tabular-nums', check.errors > 0 ? 'bg-destructive text-white' : 'bg-amber-500 text-amber-950')}
              >
                <span aria-hidden>{check.errors + check.warnings}</span>
                <span className="sr-only">
                  {[check.errors > 0 && `${check.errors} ${check.errors === 1 ? 'error' : 'errors'}`, check.warnings > 0 && `${check.warnings} ${check.warnings === 1 ? 'warning' : 'warnings'}`].filter(Boolean).join(', ')}
                </span>
              </span>
            )}
          </Button>
        </Hint>
      )}
      <Hint label={document.preview_url ? (isPopup ? 'See this popup on your store at once, whatever its trigger (new tab)' : 'See your draft on the store (new tab)') : 'Preview needs a store address — add a domain under Settings & domains'}>
        {/* A span keeps the tooltip working on the disabled button. */}
        <span tabIndex={document.preview_url ? undefined : 0}>
          <Button type="button" variant="outline" disabled={!document.preview_url} onClick={onPreview} aria-label={isPopup ? 'Preview on store' : 'Preview draft'}>
            <ExternalLinkIcon /> {isPopup ? 'Preview on store' : 'Preview'}
          </Button>
        </span>
      </Hint>
      {!canPublish && canSubmit ? (
        <Hint label={readOnly ? 'Someone else is editing this page' : 'Send this draft to someone who can publish it'}>
          <Button type="button" onClick={onSubmitReview} disabled={readOnly}>
            <SendIcon /> Submit for review
          </Button>
        </Hint>
      ) : (
        <Hint label={readOnly ? 'Someone else is editing this page' : canPublish ? 'Make this draft live on your store, now or later' : 'You don’t have permission to publish'}>
          <span tabIndex={canPublish && !readOnly ? undefined : 0}>
            <Button type="button" disabled={!canPublish || readOnly} onClick={onPublish}>
              <RocketIcon /> Publish
            </Button>
          </span>
        </Hint>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="ghost" size="icon" aria-label="More page actions" title="More page actions">
            <EllipsisIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={onHistory}>
            <HistoryIcon /> Version history
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!document.published || readOnly} onSelect={onDiscard} className={cn((!document.published || readOnly) && 'opacity-50')}>
            <UndoDotIcon /> Discard changes
          </DropdownMenuItem>
          {onDownload && (
            <DropdownMenuItem onSelect={onDownload}>
              <DownloadIcon /> Download a copy (.json)
            </DropdownMenuItem>
          )}
          {onShortcuts && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={onShortcuts}>
                <KeyboardIcon /> Keyboard shortcuts
                <DropdownMenuShortcut>?</DropdownMenuShortcut>
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  )
}
