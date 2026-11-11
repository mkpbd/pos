import { useState, type ReactNode } from 'react'
import { Link } from 'react-router'
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
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { Device } from '@/storefront/builder/types'
import { problemCount } from './autosave'
import { DEVICE_WIDTHS } from './canvas-config'
import { IS_MAC, useRelativeTime } from './format'
import { isDirty, useEditor, type SaveState } from './store'

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
  onRename: (title: string) => Promise<void>
  onPreview: () => void
  onPublish: () => void
  onDiscard: () => void
  onHistory: () => void
  onShowProblem: () => void
}

export function Toolbar({ canPublish, onRename, onPreview, onPublish, onDiscard, onHistory, onShowProblem }: ToolbarProps) {
  const document = useEditor((s) => s.document)
  const device = useEditor((s) => s.device)
  const setDevice = useEditor((s) => s.setDevice)
  const canUndo = useEditor((s) => s.history.past.length > 0)
  const canRedo = useEditor((s) => s.history.future.length > 0)
  const undo = useEditor((s) => s.undo)
  const redo = useEditor((s) => s.redo)

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
        <TitleField title={document.title} canEdit onRename={onRename} />
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

      <Hint label={document.preview_url ? 'See your draft on the store (new tab)' : 'Preview needs a store address — add a domain under Settings & domains'}>
        {/* A span keeps the tooltip working on the disabled button. */}
        <span tabIndex={document.preview_url ? undefined : 0}>
          <Button type="button" variant="outline" disabled={!document.preview_url} onClick={onPreview} aria-label="Preview draft">
            <ExternalLinkIcon /> Preview
          </Button>
        </span>
      </Hint>
      <Hint label={canPublish ? 'Make this draft live on your store' : 'You don’t have permission to publish'}>
        <span tabIndex={canPublish ? undefined : 0}>
          <Button type="button" disabled={!canPublish} onClick={onPublish}>
            <RocketIcon /> Publish
          </Button>
        </span>
      </Hint>
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
          <DropdownMenuItem disabled={!document.published} onSelect={onDiscard} className={cn(!document.published && 'opacity-50')}>
            <UndoDotIcon /> Discard changes
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  )
}
