import type { ReactNode } from 'react'
import { useDraggable } from '@dnd-kit/core'
import { ArrowDownIcon, ArrowUpIcon, ArrowUpLeftIcon, BookmarkPlusIcon, ClipboardCopyIcon, CopyIcon, EllipsisIcon, EyeIcon, EyeOffIcon, GripVerticalIcon, ImageUpIcon, PencilIcon, TypeIcon, Trash2Icon } from 'lucide-react'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
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
import { useEditor, useEditorStoreApi } from './store'
import { findNode } from './tree'
import { dropTargetOf } from './media-upload'

function ToolButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="flex size-7 items-center justify-center rounded text-white hover:bg-white/20 focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none disabled:opacity-40 [&_svg]:size-3.5"
    >
      {children}
    </button>
  )
}

/** The floating toolbar of the selected node on the canvas. B10: Edit text, Replace picture and the text quick bar. */
export function MiniToolbar({ theme, onEditText, onReplacePicture }: { theme?: QuickTheme; onEditText?: (id: string) => void; onReplacePicture?: (id: string) => void } = {}) {
  const store = useEditorStoreApi()
  const selection = useEditor((s) => s.selection)
  const content = useEditor((s) => s.content)
  const device = useEditor((s) => s.device)
  const { registry, globals } = useEditorUi()
  const commands = useCommands()
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
          <ToolButton label="Move up" disabled={info.index === 0} onClick={() => commands.step(id, -1)}>
            <ArrowUpIcon aria-hidden />
          </ToolButton>
          <ToolButton label="Move down" disabled={info.index >= siblings - 1} onClick={() => commands.step(id, 1)}>
            <ArrowDownIcon aria-hidden />
          </ToolButton>
          <ToolButton label="Duplicate" onClick={() => commands.duplicate(id)}>
            <CopyIcon aria-hidden />
          </ToolButton>
          <ToolButton label="Copy (paste it on any page)" onClick={() => commands.copy(id)}>
            <ClipboardCopyIcon aria-hidden />
          </ToolButton>
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
