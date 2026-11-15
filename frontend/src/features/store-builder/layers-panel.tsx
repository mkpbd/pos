import { useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import { DndContext, PointerSensor, pointerWithin, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent, type DragMoveEvent } from '@dnd-kit/core'
import { ArrowDownIcon, ArrowUpIcon, BookmarkPlusIcon, CircleAlertIcon, CopyIcon, EllipsisIcon, EyeIcon, EyeOffIcon, GripVerticalIcon, RotateCcwIcon, SmartphoneIcon, TabletIcon, Trash2Icon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { DEVICE_ORDER_ROOT, ownDeviceOrder } from '@/storefront/builder/device-order'
import type { Device, DeviceOrder, OrderDevice } from '@/storefront/builder/types'
import { nodeLabel, nodeName, nodeSummary, useCommands, useEditorUi } from './commands'
import { canMoveInDeviceOrder, isOrderDevice, placeInDeviceOrder, resetDeviceOrder } from './device-order-edit'
import { canMoveGroup, moveLabels } from './group-ops'
import type { Dragged, LayerPosition } from './drop-targets'
import { NodeClipboardItems } from './clipboard-menu'
import { useEditor, useEditorStoreApi, useSelectedIds } from './store'
import { ElementIcon } from './element-icon'
import { flattenLayers, layerDropSpot, layerRange, type LayerRow } from './layers'

/*
 * The Layers tree (section → column → element). Select a row, drag its handle to reorder or move
 * it across columns and sections (pointer, or keyboard: focus the handle, Space, arrows, Space),
 * eye = hide / show, ⋯ = move, duplicate, delete. Arrow keys move the selection; Delete asks to
 * delete the selected node.
 *
 * B12: Ctrl/Cmd+click (or Ctrl+Space) adds a row to the selection, Shift+click (Shift+↑ / ↓) picks
 * the rows in between (siblings, in the order shown), Esc clears it; Alt+↑ / Alt+↓ move the focused
 * item (or the selected ones) one place. In Tablet / Mobile view the list is the device's order
 * ("Order on phones"): dragging and moving change that device's order only, never the computer's;
 * "Same as computer" goes back. Containers with an own order carry a badge.
 */

export type LayerIndicator = { rowId: string; position: LayerPosition } | null

const DEVICE_WORDS: Record<OrderDevice, { plural: string; badge: string; heading: string }> = {
  tablet: { plural: 'tablets', badge: 'Own tablet order', heading: 'Order on tablets' },
  mobile: { plural: 'phones', badge: 'Own phone order', heading: 'Order on phones' },
}

function OrderBadge({ device, order, containerId }: { device: Device; order: DeviceOrder | undefined; containerId: string }) {
  // On the computer: a hint that tablets or phones show it differently.
  const devices: OrderDevice[] = isOrderDevice(device) ? [device] : (['tablet', 'mobile'] as const).filter((d) => ownDeviceOrder(order, d, containerId) !== null)
  const own = devices.filter((d) => ownDeviceOrder(order, d, containerId) !== null)
  if (own.length === 0) return null
  const text = own.length === 2 ? 'Own phone & tablet order' : DEVICE_WORDS[own[0]!].badge
  return (
    <span data-testid={`order-badge-${containerId}`} className="shrink-0 rounded bg-sky-100 px-1 py-0.5 text-[10px] leading-none font-medium text-sky-900 dark:bg-sky-900/40 dark:text-sky-100" title={`${text}: shoppers on ${own.map((d) => DEVICE_WORDS[d].plural).join(' and ')} see these in a different order than on a computer.`}>
      {text}
    </span>
  )
}

function LayerItem({ row, selected, group, tabbable, hasErrors, indicator, ordering, device, order, onSelectRow, onResetOrder }: {
  row: LayerRow
  /** B12: the selected ids when this row is one of several selected (its ⋯ menu acts on all of them). */
  group: string[] | null
  selected: boolean
  tabbable: boolean
  hasErrors: boolean
  indicator: LayerPosition | null
  /** B12: tablet / phone view — drags and moves change the device's order. */
  ordering: OrderDevice | null
  device: Device
  order: DeviceOrder | undefined
  onSelectRow: (id: string, event: MouseEvent) => void
  onResetOrder: (containerId: string) => void
}) {
  const { registry, globals } = useEditorUi()
  const commands = useCommands()
  const { node, kind } = row
  const label = row.kind === 'column' ? `Column ${row.columnNumber} of ${row.count}` : nodeLabel(node, registry)
  const summary = nodeSummary(node, registry, globals)
  const name = row.kind === 'column' ? label : nodeName(node, registry, globals)
  const hidden = kind !== 'column' && (node as { hidden?: boolean }).hidden === true
  // On tablets and phones only sections and the elements of a column change order (not columns).
  const dragged: Dragged | null = kind === 'column' || (ordering && !row.containerId) ? null : { kind: 'node', id: node.id, type: node.type }
  const { attributes, listeners, setNodeRef: setDragRef, isDragging } = useDraggable({ id: `layer-drag:${node.id}`, data: { dragged }, disabled: dragged === null })
  const { setNodeRef: setDropRef } = useDroppable({ id: `layer:${node.id}`, data: { nodeId: node.id, kind } })
  const words = ordering ? DEVICE_WORDS[ordering] : null
  const ownColumnOrder = ordering && kind === 'column' && ownDeviceOrder(order, ordering, node.id) !== null
  const store = useEditorStoreApi()
  // The same words and checks as the canvas mini toolbar (group-ops).
  const labels = moveLabels(store.getState().content, device, group ?? [node.id])
  const canGroupMove = (direction: -1 | 1) => {
    const { content } = store.getState()
    return labels.deviceOnly ? canMoveInDeviceOrder(content, device, group!, direction) : canMoveGroup(content, group!, direction) === null
  }

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
            // Keyboard: Alt+↑ / Alt+↓ on the row (the order drag is pointer only).
            tabIndex={ordering ? -1 : attributes.tabIndex}
            aria-label={ordering ? `Drag ${name} to change its order on ${words!.plural}` : `Drag ${name}`}
            title={ordering ? `Drag to change the order on ${words!.plural} (or Alt+↑ / Alt+↓)` : 'Drag to move'}
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
          onClick={(event) => onSelectRow(node.id, event)}
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded px-1 py-0.5 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <ElementIcon type={node.type} className="size-3.5 shrink-0 text-muted-foreground" />
          <span className={cn('shrink-0', kind === 'section' && 'font-medium', hidden && 'line-through')}>{label}</span>
          {summary && <span className="min-w-0 truncate text-xs text-muted-foreground">{summary}</span>}
          {kind === 'column' && <OrderBadge device={device} order={order} containerId={node.id} />}
          {hasErrors && <CircleAlertIcon className="size-3.5 shrink-0 text-destructive" aria-label="Has problems" />}
        </button>
        {ownColumnOrder && (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={`${resetLabel(order, ordering, node.id)} for ${name}`}
            title={`${resetLabel(order, ordering, node.id)}: the elements of this column go back to the ${resetsTo(order, ordering, node.id)} order on ${words!.plural}`}
            onClick={() => onResetOrder(node.id)}
          >
            <RotateCcwIcon />
          </Button>
        )}
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
              {group && <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">{group.length} selected items</DropdownMenuLabel>}
              <DropdownMenuItem disabled={group ? !canGroupMove(-1) : row.index === 0} onSelect={() => (group ? commands.stepMany(group, -1) : commands.step(node.id, -1))}>
                <ArrowUpIcon /> {labels.up}
              </DropdownMenuItem>
              <DropdownMenuItem disabled={group ? !canGroupMove(1) : row.index === row.count - 1} onSelect={() => (group ? commands.stepMany(group, 1) : commands.step(node.id, 1))}>
                <ArrowDownIcon /> {labels.down}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => (group ? commands.duplicateMany(group) : commands.duplicate(node.id))}>
                <CopyIcon /> {group ? `Duplicate ${group.length} items` : 'Duplicate'}
              </DropdownMenuItem>
              {kind === 'section' && commands.requestSaveTemplate && (
                <DropdownMenuItem onSelect={() => commands.requestSaveTemplate?.(node.id)}>
                  <BookmarkPlusIcon /> Save as template
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <NodeClipboardItems id={node.id} kind={kind} />
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => (group ? commands.requestDeleteMany(group) : commands.requestDelete(node.id))}>
                <Trash2Icon /> {group ? `Delete ${group.length} items` : 'Delete'}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </li>
  )
}

/** Deleting a phone order shows the tablet's own order when there is one (see resetTarget). */
function resetsTo(order: DeviceOrder | undefined, device: OrderDevice, containerId: string): 'tablet' | 'computer' {
  return device === 'mobile' && ownDeviceOrder(order, 'tablet', containerId) !== null ? 'tablet' : 'computer'
}

function resetLabel(order: DeviceOrder | undefined, device: OrderDevice, containerId: string): string {
  return resetsTo(order, device, containerId) === 'tablet' ? 'Same as tablet' : 'Same as computer'
}

/** B12: the "Order on phones" note above the list in Tablet / Mobile view. */
function OrderBanner({ device, order, onReset }: { device: OrderDevice; order: DeviceOrder | undefined; onReset: () => void }) {
  const words = DEVICE_WORDS[device]
  const Icon = device === 'mobile' ? SmartphoneIcon : TabletIcon
  const own = ownDeviceOrder(order, device, DEVICE_ORDER_ROOT) !== null
  return (
    <section aria-label={words.heading} className="mx-2 mt-2 flex flex-col gap-1.5 rounded-md border border-primary/30 bg-primary/5 p-2.5" data-testid="device-order-banner">
      <div className="flex items-center gap-1.5">
        <Icon className="size-4 shrink-0 text-primary" aria-hidden />
        <h3 className="text-sm font-medium">{words.heading}</h3>
        <OrderBadge device={device} order={order} containerId={DEVICE_ORDER_ROOT} />
      </div>
      <p className="text-xs text-muted-foreground">
        Shown in the order shoppers see on {words.plural}. Drag the handle or press Alt+↑ / Alt+↓ to change it — only on {words.plural}; the computer order stays as it is.
        {device === 'tablet' ? ' Phones follow it unless they have their own order.' : ''}
      </p>
      {own && (
        <Button type="button" variant="outline" size="sm" className="self-start" onClick={onReset}>
          <RotateCcwIcon data-icon="inline-start" /> {resetLabel(order, device, DEVICE_ORDER_ROOT)} (sections)
        </Button>
      )}
    </section>
  )
}

export function LayersPanel({ indicator }: { indicator: LayerIndicator }) {
  const store = useEditorStoreApi()
  const content = useEditor((s) => s.content)
  const selection = useEditor((s) => s.selection)
  const device = useEditor((s) => s.device)
  const selectedIds = useSelectedIds()
  const errors = useEditor((s) => s.errors)
  const commands = useCommands()
  const rows = useMemo(() => flattenLayers(content, device), [content, device])
  const treeRef = useRef<HTMLUListElement>(null)
  const ordering = isOrderDevice(device) ? device : null
  const [orderDrop, setOrderDrop] = useState<LayerIndicator>(null)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  const focusRow = (id: string) => {
    requestAnimationFrame(() => treeRef.current?.querySelector<HTMLButtonElement>(`[data-layer-id="${id}"]`)?.focus())
  }

  const selectRow = (id: string) => {
    store.getState().select(id)
    commands.reveal(id)
  }

  const onRowClick = (id: string, event: MouseEvent) => {
    const state = store.getState()
    if (event.ctrlKey || event.metaKey) return state.toggleSelect(id)
    if (event.shiftKey) {
      const range = layerRange(rows, state.selection, id)
      return range ? state.selectMany([...state.selectedIds, ...range], id) : state.selectRange(id)
    }
    selectRow(id)
  }

  const resetOrder = (containerId: string) => {
    if (!ordering) return
    store.getState().apply((c) => resetDeviceOrder(c, ordering, containerId))
  }

  const onKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    const target = event.target as HTMLElement
    // Keyboard dragging (on a handle) and the row menus handle their own keys.
    const focused = target.dataset.layerId
    if (!focused) return
    const state = store.getState()
    const index = rows.findIndex((row) => row.node.id === state.selection)
    const vertical = event.key === 'ArrowDown' || event.key === 'ArrowUp'
    const direction: -1 | 1 = event.key === 'ArrowDown' ? 1 : -1
    if (vertical && event.altKey) {
      // Move the focused item (or the selected items it belongs to) one place.
      event.preventDefault()
      event.stopPropagation()
      const row = rows.find((r) => r.node.id === focused)
      if (!row || row.kind === 'column' || (ordering && !row.containerId)) return
      const ids = state.selectedIds.includes(focused) && state.selectedIds.length > 1 ? state.selectedIds : [focused]
      if (ids.length > 1) commands.stepMany(ids, direction)
      else commands.step(focused, direction)
      focusRow(focused)
    } else if (vertical) {
      event.preventDefault()
      event.stopPropagation()
      const next = rows[Math.max(0, Math.min(rows.length - 1, index + direction))] ?? rows[0]
      if (!next) return
      if (event.shiftKey && state.selection) {
        // Extend over siblings (others: just add).
        const range = layerRange(rows, state.selection, next.node.id)
        if (range) state.selectMany([...state.selectedIds, next.node.id], next.node.id)
        else state.selectRange(next.node.id)
      } else selectRow(next.node.id)
      focusRow(next.node.id)
    } else if (event.key === ' ' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault()
      event.stopPropagation()
      state.toggleSelect(focused)
    } else if (event.key === 'Escape' && state.selectedIds.length > 1) {
      event.preventDefault()
      event.stopPropagation()
      state.clearSelection()
    } else if ((event.key === 'Delete' || event.key === 'Backspace') && state.selection) {
      event.preventDefault()
      event.stopPropagation()
      if (state.selectedIds.length > 1) return commands.requestDeleteMany(state.selectedIds)
      const row = rows[index]
      if (row && row.kind !== 'column') commands.requestDelete(state.selection)
    }
  }

  /* B12: "Order on phones" drag (its own drag context: drops change the device's order only). */
  const spotOf = (event: DragMoveEvent | DragEndEvent) => {
    const dragged = (event.active.data.current as { dragged?: Dragged | null } | undefined)?.dragged
    const overId = (event.over?.data.current as { nodeId?: string } | undefined)?.nodeId
    if (!dragged || dragged.kind !== 'node' || !overId || !event.over) return null
    const start = event.activatorEvent as PointerEvent | null
    const y = (start && 'clientY' in start ? start.clientY : 0) + event.delta.y
    const rect = event.over.rect
    return layerDropSpot(rows, dragged.id, overId, y < rect.top + rect.height / 2)
  }
  const onOrderMove = (event: DragMoveEvent) => {
    const spot = spotOf(event)
    const next: LayerIndicator = spot ? { rowId: spot.indicatorRowId, position: spot.position } : null
    setOrderDrop((current) => (current?.rowId === next?.rowId && current?.position === next?.position ? current : next))
  }
  const onOrderEnd = (event: DragEndEvent) => {
    setOrderDrop(null)
    const spot = spotOf(event)
    const dragged = (event.active.data.current as { dragged?: Dragged | null } | undefined)?.dragged
    if (!spot || !ordering || !dragged || dragged.kind !== 'node') return
    const id = dragged.id
    store.getState().apply((c) => placeInDeviceOrder(c, ordering, spot.containerId, id, spot.index), { select: id })
  }

  if (rows.length === 0) {
    return <p className="p-4 text-sm text-muted-foreground">No sections yet. Add an element to start your page.</p>
  }

  // The first row is reachable with Tab when nothing is selected.
  const tabStop = rows.some((row) => row.node.id === selection) ? selection : rows[0]?.node.id
  const shownIndicator = ordering ? orderDrop : indicator
  const selectedSet = new Set(selectedIds)

  const tree = (
    <ul ref={treeRef} role="tree" aria-label={ordering ? `Page layers, ${DEVICE_WORDS[ordering].heading.toLowerCase()}` : 'Page layers'} aria-multiselectable="true" className="flex flex-col" onKeyDown={onKeyDown}>
      {rows.map((row) => (
        <LayerItem
          key={row.node.id}
          row={row}
          selected={selectedSet.has(row.node.id) || row.node.id === selection}
          group={selectedIds.length > 1 && selectedSet.has(row.node.id) ? selectedIds : null}
          tabbable={row.node.id === tabStop}
          hasErrors={(errors[row.node.id]?.length ?? 0) > 0}
          indicator={shownIndicator?.rowId === row.node.id ? shownIndicator.position : null}
          ordering={ordering}
          device={device}
          order={content.device_order}
          onSelectRow={onRowClick}
          onResetOrder={resetOrder}
        />
      ))}
    </ul>
  )

  let body: ReactNode = tree
  if (ordering) {
    body = (
      <DndContext sensors={sensors} collisionDetection={pointerWithin} onDragMove={onOrderMove} onDragEnd={onOrderEnd} onDragCancel={() => setOrderDrop(null)}>
        {tree}
      </DndContext>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {ordering && <OrderBanner device={ordering} order={content.device_order} onReset={() => resetOrder(DEVICE_ORDER_ROOT)} />}
      {!ordering && (ownDeviceOrder(content.device_order, 'tablet', DEVICE_ORDER_ROOT) || ownDeviceOrder(content.device_order, 'mobile', DEVICE_ORDER_ROOT)) && (
        <p className="mx-2 mt-2 flex items-center gap-1.5 text-xs text-muted-foreground" data-testid="device-order-note">
          <OrderBadge device={device} order={content.device_order} containerId={DEVICE_ORDER_ROOT} /> Sections show in another order there — switch to Tablet or Mobile view to see or change it.
        </p>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto p-2">{body}</div>
    </div>
  )
}
