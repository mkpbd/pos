import type { ReactNode } from 'react'
import { useDraggable } from '@dnd-kit/core'
import { ArrowDownIcon, ArrowUpIcon, ArrowUpLeftIcon, BookmarkPlusIcon, ChartGanttIcon, ClipboardCopyIcon, CopyIcon, EllipsisIcon, EyeIcon, EyeOffIcon, GlobeIcon, GripVerticalIcon, ImageUpIcon, PaintbrushIcon, PaintBucketIcon, PencilIcon, RowsIcon, SquareDashedIcon, TypeIcon, Trash2Icon, XIcon } from 'lucide-react'
import { toast } from 'sonner'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import type { Section } from '@/storefront/builder/types'
import { nodeLabel, nodeName, useCommands, useEditorUi } from './commands'
import type { Dragged } from './drop-targets'
import { globalRefOf } from './global-sections'
import { NodeClipboardItems } from './clipboard-menu'
import { firstInlineField } from './inline-edit'
import { QuickBar, type QuickTheme } from './quick-bar'
import { QUICK_TEXT_TYPES, setNodeStyleValue } from './quick-style'
import { BREAKPOINT } from './inspector/style-model'
import { canMoveInDeviceOrder } from './device-order-edit'
import { canMoveGroup, canWrapInInnerRow, canWrapInSection, deletableNodes, groupHides, moveLabels } from './group-ops'
import { NOT_SIBLINGS_REASON, siblingGroup } from './selection'
import { useEditor, useEditorStoreApi, useSelectedIds } from './store'
import { findNode } from './tree'
import { dropTargetOf } from './media-upload'
import { useMotionUi } from './timeline/motion-ui'

/** `reason`: why it can't be used now — the button stays focusable, says why and shows the reason when pressed. */
function ToolButton({ label, onClick, disabled, reason, children }: { label: string; onClick: () => void; disabled?: boolean; reason?: string | null; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={reason ? `${label} (not available: ${reason})` : label}
      title={reason ? `${label} — ${reason}` : label}
      disabled={disabled}
      aria-disabled={reason ? true : undefined}
      onClick={() => (reason ? toast.info(reason) : onClick())}
      className="flex size-7 items-center justify-center rounded text-white hover:bg-white/20 focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none disabled:opacity-40 aria-disabled:opacity-40 [&_svg]:size-3.5"
    >
      {children}
    </button>
  )
}

/** The floating toolbar of the selected node on the canvas (B12: of the selected group when several are selected). */
export function MiniToolbar(props: { theme?: QuickTheme; onEditText?: (id: string) => void; onReplacePicture?: (id: string) => void } = {}) {
  const selectedIds = useSelectedIds()
  return selectedIds.length > 1 ? <GroupToolbar ids={selectedIds} /> : <SingleToolbar {...props} />
}

function SingleToolbar({ theme, onEditText, onReplacePicture }: { theme?: QuickTheme; onEditText?: (id: string) => void; onReplacePicture?: (id: string) => void }) {
  const store = useEditorStoreApi()
  const selection = useEditor((s) => s.selection)
  const content = useEditor((s) => s.content)
  const device = useEditor((s) => s.device)
  const { registry, globals } = useEditorUi()
  const commands = useCommands()
  const motionUi = useMotionUi()
  const info = findNode(content, selection)
  const dragged: Dragged | null = info && info.kind !== 'column' ? { kind: 'node', id: info.node.id, type: info.node.type } : null
  const { attributes, listeners, setNodeRef } = useDraggable({ id: `canvas-drag:${selection ?? ''}`, data: { dragged }, disabled: dragged === null })
  if (!info) return null
  const id = info.node.id
  const hidden = (info.node as { hidden?: boolean }).hidden === true
  const label = nodeLabel(info.node, registry)
  const siblings = info.kind === 'section' ? content.sections.length : info.kind === 'element' ? ((findNode(content, info.parentId)?.node as { elements?: unknown[] } | undefined)?.elements?.length ?? 1) : 1
  const parentLabel = info.parentId ? nodeLabel(findNode(content, info.parentId)!.node as Section, registry).toLowerCase() : null
  const name = nodeName(info.node, registry, globals)
  const ref = globalRefOf(info.node)
  const moves = moveLabels(content, device, [id])
  const canUp = moves.deviceOnly ? canMoveInDeviceOrder(content, device, id, -1) : info.index > 0
  const canDown = moves.deviceOnly ? canMoveInDeviceOrder(content, device, id, 1) : info.index < siblings - 1

  return (
    <div role="group" aria-label={`${label} actions`} data-testid="mini-toolbar" className="flex items-center gap-0.5 rounded-md bg-blue-600 p-0.5 shadow-lg">
      {dragged && (
        <button
          ref={setNodeRef}
          type="button"
          {...attributes}
          {...listeners}
          aria-label={`Drag ${label}`}
          title="Drag to move"
          className={cn('flex size-7 cursor-grab items-center justify-center rounded text-white hover:bg-white/20 active:cursor-grabbing [&_svg]:size-3.5')}
        >
          <GripVerticalIcon aria-hidden />
        </button>
      )}
      <span className="max-w-56 truncate px-1.5 text-xs font-medium whitespace-nowrap text-white" title={name}>{name}</span>
      {onEditText && info.kind === 'element' && firstInlineField(content, id) !== null && (
        <ToolButton label="Edit text on the page (Enter)" onClick={() => onEditText(id)}>
          <TypeIcon aria-hidden />
        </ToolButton>
      )}
      {onReplacePicture && dropTargetOf(info.node, BREAKPOINT[device]) && (
        <ToolButton label={info.node.type === 'image' ? 'Replace picture' : 'Replace background picture'} onClick={() => onReplacePicture(id)}>
          <ImageUpIcon aria-hidden />
        </ToolButton>
      )}
      {ref && commands.openGlobal && (
        <ToolButton label="Edit global section" onClick={() => commands.openGlobal?.(ref.ref)}>
          <PencilIcon aria-hidden />
        </ToolButton>
      )}
      {info.kind !== 'column' && (
        <>
          <ToolButton label={moves.up} disabled={!canUp} onClick={() => commands.step(id, -1)}>
            <ArrowUpIcon aria-hidden />
          </ToolButton>
          <ToolButton label={moves.down} disabled={!canDown} onClick={() => commands.step(id, 1)}>
            <ArrowDownIcon aria-hidden />
          </ToolButton>
          <ToolButton label="Duplicate" onClick={() => commands.duplicate(id)}>
            <CopyIcon aria-hidden />
          </ToolButton>
          <ToolButton label="Copy (paste it on any page)" onClick={() => commands.copy(id)}>
            <ClipboardCopyIcon aria-hidden />
          </ToolButton>
          {/* B18: the section's motion timeline. */}
          {info.kind === 'section' && !ref && motionUi && (
            <ToolButton label="Motion timeline" onClick={() => motionUi.openTimeline(id)}>
              <ChartGanttIcon aria-hidden />
            </ToolButton>
          )}
          {info.kind === 'section' && commands.requestSaveTemplate && (
            <ToolButton label="Save as template" onClick={() => commands.requestSaveTemplate?.(id)}>
              <BookmarkPlusIcon aria-hidden />
            </ToolButton>
          )}
          <ToolButton label={hidden ? 'Show' : 'Hide'} onClick={() => commands.toggleHidden(id)}>
            {hidden ? <EyeIcon aria-hidden /> : <EyeOffIcon aria-hidden />}
          </ToolButton>
          <ToolButton label="Delete" onClick={() => commands.requestDelete(id)}>
            <Trash2Icon aria-hidden />
          </ToolButton>
        </>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`More actions for ${name}`}
            title="More actions"
            className="flex size-7 items-center justify-center rounded text-white hover:bg-white/20 focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none [&_svg]:size-3.5"
          >
            <EllipsisIcon aria-hidden />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <NodeClipboardItems id={id} kind={info.kind} />
        </DropdownMenuContent>
      </DropdownMenu>
      {QUICK_TEXT_TYPES.has(info.node.type) && (
        <QuickBar
          node={info.node}
          device={device}
          theme={theme}
          onApply={(path, value) => store.getState().apply((c) => setNodeStyleValue(c, id, BREAKPOINT[device], path, value), { coalesceKey: `quick:${id}:${path.join('.')}` })}
        />
      )}
      {parentLabel && (
        <ToolButton label={`Select the ${parentLabel}`} onClick={() => commands.selectParent(id)}>
          <ArrowUpLeftIcon aria-hidden />
        </ToolButton>
      )}
    </div>
  )
}

/** B12: the toolbar of several selected items ("3 selected"): group actions, each one undo step. */
function GroupToolbar({ ids }: { ids: string[] }) {
  const store = useEditorStoreApi()
  const content = useEditor((s) => s.content)
  const device = useEditor((s) => s.device)
  const { single = false } = useEditorUi()
  const commands = useCommands()
  const count = ids.length
  const group = siblingGroup(content, ids)
  const moves = moveLabels(content, device, ids)
  const moveReason = (direction: -1 | 1) => {
    if (!moves.deviceOnly) return canMoveGroup(content, ids, direction)
    if (!group) return NOT_SIBLINGS_REASON
    return canMoveInDeviceOrder(content, device, ids, direction) ? null : direction === -1 ? 'Already at the top.' : 'Already at the bottom.'
  }
  const upReason = moveReason(-1)
  const downReason = moveReason(1)
  const atEnd = (reason: string | null) => reason === 'Already at the top.' || reason === 'Already at the bottom.'
  const siblingReason = group && group.kind !== 'column' ? null : group ? 'Columns are added and removed with the column layout of their section.' : 'Pick items that sit side by side in the same place (the same column, or sections of the page) to duplicate them together.'
  const deletable = deletableNodes(content, ids).length
  const hides = groupHides(content, ids)
  const innerReason = canWrapInInnerRow(content, ids)
  const sectionReason = canWrapInSection(content, ids, single)
  const canPasteStyle = commands.canPasteStyleToMany(ids)
  const primary = store.getState().selection

  return (
    <div role="group" aria-label={`${count} selected items: actions`} data-testid="group-toolbar" className="flex items-center gap-0.5 rounded-md bg-blue-600 p-0.5 shadow-lg">
      <span className="px-1.5 text-xs font-medium whitespace-nowrap text-white" data-testid="selected-count" aria-live="polite">
        {count} selected
      </span>
      <ToolButton label={moves.up} disabled={atEnd(upReason)} reason={atEnd(upReason) ? null : upReason} onClick={() => commands.stepMany(ids, -1)}>
        <ArrowUpIcon aria-hidden />
      </ToolButton>
      <ToolButton label={moves.down} disabled={atEnd(downReason)} reason={atEnd(downReason) ? null : downReason} onClick={() => commands.stepMany(ids, 1)}>
        <ArrowDownIcon aria-hidden />
      </ToolButton>
      <ToolButton label="Duplicate all" reason={siblingReason} onClick={() => commands.duplicateMany(ids)}>
        <CopyIcon aria-hidden />
      </ToolButton>
      <ToolButton label="Copy all (paste them on any page)" onClick={() => commands.copyMany(ids)}>
        <ClipboardCopyIcon aria-hidden />
      </ToolButton>
      <ToolButton label={hides ? 'Hide all' : 'Show all'} onClick={() => commands.toggleHiddenMany(ids)}>
        {hides ? <EyeOffIcon aria-hidden /> : <EyeIcon aria-hidden />}
      </ToolButton>
      <ToolButton label={`Delete all (${deletable})`} reason={deletable === 0 ? 'Columns are removed with the column layout of their section.' : null} onClick={() => commands.requestDeleteMany(ids)}>
        <Trash2Icon aria-hidden />
      </ToolButton>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`More actions for the ${count} selected items`}
            title="More actions"
            className="flex size-7 items-center justify-center rounded text-white hover:bg-white/20 focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none [&_svg]:size-3.5"
          >
            <EllipsisIcon aria-hidden />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="max-w-72">
          <DropdownMenuItem disabled={!primary} onSelect={() => primary && commands.copyStyleOf(primary)}>
            <PaintbrushIcon /> Copy style of the last picked
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!canPasteStyle} onSelect={() => commands.pasteStyleToMany(ids)}>
            <PaintBucketIcon /> Paste style to all
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={innerReason !== null} onSelect={() => commands.wrapInInnerRow(ids)}>
            <RowsIcon />
            <span className="flex flex-col">
              Wrap in an inner row
              {innerReason && <span className="text-xs text-muted-foreground">{innerReason}</span>}
            </span>
          </DropdownMenuItem>
          <DropdownMenuItem disabled={sectionReason !== null} onSelect={() => commands.wrapInSection(ids)}>
            <SquareDashedIcon />
            <span className="flex flex-col">
              Wrap in a new section
              {sectionReason && <span className="text-xs text-muted-foreground">{sectionReason}</span>}
            </span>
          </DropdownMenuItem>
          {commands.requestMakeGlobal && (
            <DropdownMenuItem disabled>
              <GlobeIcon />
              <span className="flex flex-col">
                Make global…
                <span className="text-xs text-muted-foreground">Select just one section to make it global.</span>
              </span>
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => store.getState().clearSelection()}>
            <XIcon /> Clear the selection
            <span className="ml-auto text-xs text-muted-foreground">Esc</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
