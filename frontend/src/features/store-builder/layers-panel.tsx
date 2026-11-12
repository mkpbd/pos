import { useMemo, useRef, type KeyboardEvent } from 'react'
import { useDraggable, useDroppable } from '@dnd-kit/core'
import { ArrowDownIcon, ArrowUpIcon, CircleAlertIcon, CopyIcon, EllipsisIcon, EyeIcon, EyeOffIcon, GripVerticalIcon, Trash2Icon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { nodeLabel, nodeName, nodeSummary, useCommands, useEditorUi } from './commands'
import type { Dragged, LayerPosition } from './drop-targets'
import { useEditor } from './store'
import { ElementIcon } from './element-icon'
import { flattenLayers, type LayerRow } from './layers'

/*
 * The Layers tree (section → column → element). Select a row, drag its handle to reorder or move
 * it across columns and sections (pointer, or keyboard: focus the handle, Space, arrows, Space),
 * eye = hide / show, ⋯ = move, duplicate, delete. Arrow keys move the selection; Delete asks to
 * delete the selected node.
 */

export type LayerIndicator = { rowId: string; position: LayerPosition } | null

function LayerItem({ row, selected, tabbable, hasErrors, indicator, onSelectRow }: { row: LayerRow; selected: boolean; tabbable: boolean; hasErrors: boolean; indicator: LayerPosition | null; onSelectRow: (id: string) => void }) {
  const { registry } = useEditorUi()
  const commands = useCommands()
  const { node, kind } = row
  const label = row.kind === 'column' ? `Column ${row.columnNumber} of ${row.count}` : nodeLabel(node, registry)
  const summary = nodeSummary(node, registry)
  const name = row.kind === 'column' ? label : nodeName(node, registry)
  const hidden = kind !== 'column' && (node as { hidden?: boolean }).hidden === true
  const dragged: Dragged | null = kind === 'column' ? null : { kind: 'node', id: node.id, type: node.type }
  const { attributes, listeners, setNodeRef: setDragRef, isDragging } = useDraggable({ id: `layer-drag:${node.id}`, data: { dragged }, disabled: dragged === null })
  const { setNodeRef: setDropRef } = useDroppable({ id: `layer:${node.id}`, data: { nodeId: node.id, kind } })

  return (
    <li
      role="treeitem"
      aria-level={row.depth + 1}
      aria-selected={selected}
      aria-label={name}
      data-testid={`layer-${node.id}`}
      className="relative"
    >
      {indicator === 'before' && <span className="absolute inset-x-1 top-0 h-0.5 rounded bg-blue-600" aria-hidden />}
      {indicator === 'after' && <span className="absolute inset-x-1 bottom-0 h-0.5 rounded bg-blue-600" aria-hidden />}
      <div
        ref={setDropRef}
        className={cn(
          'group flex h-8 items-center gap-1 rounded-md pr-1 text-sm',
          selected ? 'bg-primary/10 text-foreground' : 'hover:bg-muted',
          indicator === 'inside' && 'ring-2 ring-blue-600 ring-inset',
          isDragging && 'opacity-40',
          hidden && 'text-muted-foreground',
        )}
        style={{ paddingLeft: 4 + row.depth * 14 }}
      >
        {dragged ? (
          <button
            ref={setDragRef}
            type="button"
            {...attributes}
            {...listeners}
            aria-label={`Drag ${name}`}
            title="Drag to move"
            className="flex size-6 shrink-0 cursor-grab items-center justify-center rounded text-muted-foreground hover:bg-muted-foreground/10 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <GripVerticalIcon className="size-3.5" aria-hidden />
          </button>
        ) : (
          <span className="size-6 shrink-0" aria-hidden />
        )}
        <button
          type="button"
          data-layer-id={node.id}
          tabIndex={tabbable ? 0 : -1}
          onClick={() => onSelectRow(node.id)}
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded px-1 py-0.5 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <ElementIcon type={node.type} className="size-3.5 shrink-0 text-muted-foreground" />
          <span className={cn('shrink-0', kind === 'section' && 'font-medium', hidden && 'line-through')}>{label}</span>
          {summary && <span className="min-w-0 truncate text-xs text-muted-foreground">{summary}</span>}
          {hasErrors && <CircleAlertIcon className="size-3.5 shrink-0 text-destructive" aria-label="Has problems" />}
        </button>
        {kind !== 'column' && (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={hidden ? `Show ${name}` : `Hide ${name}`}
            title={hidden ? 'Hidden from shoppers — click to show' : 'Hide from shoppers'}
            aria-pressed={hidden}
            onClick={() => commands.toggleHidden(node.id)}
            className={cn(!hidden && !selected && 'opacity-0 group-focus-within:opacity-100 group-hover:opacity-100')}
          >
            {hidden ? <EyeOffIcon /> : <EyeIcon />}
          </Button>
        )}
        {kind !== 'column' && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="ghost" size="icon-xs" aria-label={`More actions for ${name}`} title="More actions" className={cn(!selected && 'opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 aria-expanded:opacity-100')}>
                <EllipsisIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem disabled={row.index === 0} onSelect={() => commands.step(node.id, -1)}>
                <ArrowUpIcon /> Move up
              </DropdownMenuItem>
              <DropdownMenuItem disabled={row.index === row.count - 1} onSelect={() => commands.step(node.id, 1)}>
                <ArrowDownIcon /> Move down
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => commands.duplicate(node.id)}>
                <CopyIcon /> Duplicate
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => commands.requestDelete(node.id)}>
                <Trash2Icon /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </li>
  )
}

export function LayersPanel({ indicator }: { indicator: LayerIndicator }) {
  const content = useEditor((s) => s.content)
  const selection = useEditor((s) => s.selection)
  const errors = useEditor((s) => s.errors)
  const select = useEditor((s) => s.select)
  const commands = useCommands()
  const rows = useMemo(() => flattenLayers(content), [content])
  const treeRef = useRef<HTMLUListElement>(null)

  const focusRow = (id: string) => {
    requestAnimationFrame(() => treeRef.current?.querySelector<HTMLButtonElement>(`[data-layer-id="${id}"]`)?.focus())
  }

  const selectRow = (id: string) => {
    select(id)
    commands.reveal(id)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    const target = event.target as HTMLElement
    // Keyboard dragging (on a handle) and the row menus handle their own keys.
    if (!target.dataset.layerId) return
    const index = rows.findIndex((row) => row.node.id === selection)
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      event.stopPropagation()
      const next = rows[Math.max(0, Math.min(rows.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))] ?? rows[0]
      if (next) {
        selectRow(next.node.id)
        focusRow(next.node.id)
      }
    } else if ((event.key === 'Delete' || event.key === 'Backspace') && selection) {
      event.preventDefault()
      event.stopPropagation()
      const row = rows[index]
      if (row && row.kind !== 'column') commands.requestDelete(selection)
    }
  }

  if (rows.length === 0) {
    return <p className="p-4 text-sm text-muted-foreground">No sections yet. Add an element to start your page.</p>
  }

  // The first row is reachable with Tab when nothing is selected.
  const tabStop = rows.some((row) => row.node.id === selection) ? selection : rows[0]?.node.id

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-2">
      <ul ref={treeRef} role="tree" aria-label="Page layers" className="flex flex-col" onKeyDown={onKeyDown}>
        {rows.map((row) => (
          <LayerItem
            key={row.node.id}
            row={row}
            selected={row.node.id === selection}
            tabbable={row.node.id === tabStop}
            hasErrors={(errors[row.node.id]?.length ?? 0) > 0}
            indicator={indicator?.rowId === row.node.id ? indicator.position : null}
            onSelectRow={selectRow}
          />
        ))}
      </ul>
    </div>
  )
}
