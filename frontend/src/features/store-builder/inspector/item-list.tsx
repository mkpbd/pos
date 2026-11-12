/*
 * B6: a repeatable list of items in an element's Content tab (accordion panels, tabs, counters,
 * gallery images, …). Each item is a collapsible card with its own fields; items can be added,
 * removed, duplicated and reordered by dragging the handle (dnd-kit, pointer and keyboard: focus
 * the handle, Space, arrows, Space) or with the move up / down buttons. The list keeps its
 * minimum and maximum count; per-item problems mark the card.
 */

import { useId, useState, type ReactNode } from 'react'
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ArrowDownIcon, ArrowUpIcon, ChevronRightIcon, CircleAlertIcon, CopyIcon, GripVerticalIcon, PlusIcon, Trash2Icon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { newItemId, type ItemListChange } from './b6-model'
import { FieldError } from './fields'

export type ItemWithId = { id: string }

export type ItemListProps<T extends ItemWithId> = {
  /** The list's name, e.g. "Panels" (also names its region). */
  label: string
  /** One item's noun, e.g. "panel" ("Add panel", "Remove panel 2"). */
  noun: string
  items: readonly T[]
  min: number
  max: number
  onChange: (items: T[], change?: ItemListChange) => void
  /** A new item with the given id. */
  create: (id: string) => T
  /** The card's title (a short summary of the item). */
  summary: (item: T, index: number) => string
  /** The item's fields. */
  children: (item: T, index: number, update: (patch: Partial<T>, coalesce?: string) => void) => ReactNode
  /** Problems by form key; an item is marked when a key starts with `<errorPrefix>.<index>.`. */
  errors?: Record<string, string>
  /** Default: `items` (the prop name). */
  errorPrefix?: string
  /** Optional thumbnail / icon at the start of each card. */
  lead?: (item: T) => ReactNode
  /** Opens the newest item after "Add" (default true). */
  openNew?: boolean
}

export function ItemList<T extends ItemWithId>(props: ItemListProps<T>) {
  const { label, noun, items, min, max, onChange, create, summary, children, errors = {}, errorPrefix = 'items', lead, openNew = true } = props
  const headingId = useId()
  const [open, setOpen] = useState<Set<string>>(() => new Set(items.length === 1 && items[0] ? [items[0].id] : []))
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }))
  const toggle = (id: string) => setOpen((current) => {
    const next = new Set(current)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })

  const canAdd = items.length < max
  const canRemove = items.length > min
  const add = () => {
    if (!canAdd) return
    const item = create(newItemId(items))
    onChange([...items, item])
    if (openNew) setOpen((current) => new Set(current).add(item.id))
  }
  const remove = (index: number) => {
    const item = items[index]
    if (!item || !canRemove) return
    onChange(items.filter((_, i) => i !== index), { removed: item.id })
  }
  const duplicate = (index: number) => {
    const item = items[index]
    if (!item || !canAdd) return
    const copy = { ...structuredClone(item), id: newItemId(items) }
    onChange([...items.slice(0, index + 1), copy, ...items.slice(index + 1)], { duplicated: { from: item.id, to: copy.id } })
    setOpen((current) => new Set(current).add(copy.id))
  }
  const move = (from: number, to: number) => {
    if (to < 0 || to >= items.length || from === to) return
    onChange(arrayMove([...items], from, to))
  }
  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    move(items.findIndex((i) => i.id === active.id), items.findIndex((i) => i.id === over.id))
  }
  const update = (index: number) => (patch: Partial<T>, coalesce?: string) => {
    const id = items[index]?.id
    onChange(items.map((item, i) => (i === index ? { ...item, ...patch } : item)), coalesce ? { typing: `${id}.${coalesce}` } : undefined)
  }

  const listError = errors[errorPrefix]

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2" data-testid={`item-list-${errorPrefix}`}>
      <div className="flex items-center gap-2">
        <h3 id={headingId} className="flex-1 text-sm font-medium">{label}</h3>
        <span className="text-xs text-muted-foreground tabular-nums">{items.length} of {max}</span>
      </div>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd} accessibility={{ screenReaderInstructions: { draggable: `To move a ${noun}, press Space, use the arrow keys, then press Space again. Escape cancels.` } }}>
        <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
          <ol className="flex flex-col gap-2">
            {items.map((item, index) => {
              const prefix = `${errorPrefix}.${index}.`
              const hasError = Object.keys(errors).some((k) => k.startsWith(prefix))
              return (
                <SortableItem
                  key={item.id}
                  id={item.id}
                  index={index}
                  count={items.length}
                  noun={noun}
                  title={summary(item, index)}
                  lead={lead?.(item)}
                  open={open.has(item.id) || hasError}
                  hasError={hasError}
                  canAdd={canAdd}
                  canRemove={canRemove}
                  onToggle={() => toggle(item.id)}
                  onMove={(to) => move(index, to)}
                  onDuplicate={() => duplicate(index)}
                  onRemove={() => remove(index)}
                >
                  {children(item, index, update(index))}
                </SortableItem>
              )
            })}
          </ol>
        </SortableContext>
      </DndContext>
      <FieldError message={listError} />
      <Button type="button" variant="outline" size="sm" className="self-start" disabled={!canAdd} onClick={add} title={canAdd ? undefined : `At most ${max}.`}>
        <PlusIcon data-icon="inline-start" /> Add {noun}
      </Button>
      {min > 0 && items.length <= min && !listError && <p className="text-xs text-muted-foreground">Needs at least {min} {min === 1 ? noun : `${noun}s`}.</p>}
    </section>
  )
}

function SortableItem({ id, index, count, noun, title, lead, open, hasError, canAdd, canRemove, onToggle, onMove, onDuplicate, onRemove, children }: {
  id: string
  index: number
  count: number
  noun: string
  title: string
  lead?: ReactNode
  open: boolean
  hasError: boolean
  canAdd: boolean
  canRemove: boolean
  onToggle: () => void
  onMove: (to: number) => void
  onDuplicate: () => void
  onRemove: () => void
  children: ReactNode
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id })
  const panelId = useId()
  const name = `${noun} ${index + 1}`
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn('rounded-md border bg-background', isDragging && 'relative z-10 shadow-md', hasError && 'border-destructive/60')}
      data-testid="item-card"
    >
      <div className="flex items-center gap-1 p-1">
        <button
          ref={setActivatorNodeRef}
          type="button"
          aria-label={`Drag to reorder ${name}`}
          className="flex size-7 shrink-0 cursor-grab touch-none items-center justify-center rounded text-muted-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
          {...attributes}
          {...listeners}
        >
          <GripVerticalIcon className="size-4" aria-hidden />
        </button>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={open ? panelId : undefined}
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded px-1 py-1 text-left text-sm outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronRightIcon className={cn('size-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')} aria-hidden />
          {lead}
          <span className="min-w-0 flex-1 truncate">{title || <span className="text-muted-foreground italic">Empty {noun}</span>}</span>
          {hasError && <CircleAlertIcon className="size-4 shrink-0 text-destructive" aria-label="has problems" />}
        </button>
        <IconAction label={`Move ${name} up`} disabled={index === 0} onClick={() => onMove(index - 1)}><ArrowUpIcon /></IconAction>
        <IconAction label={`Move ${name} down`} disabled={index === count - 1} onClick={() => onMove(index + 1)}><ArrowDownIcon /></IconAction>
        <IconAction label={`Duplicate ${name}`} disabled={!canAdd} onClick={onDuplicate}><CopyIcon /></IconAction>
        <IconAction label={`Remove ${name}`} disabled={!canRemove} onClick={onRemove}><Trash2Icon /></IconAction>
      </div>
      {open && (
        <div id={panelId} role="group" aria-label={name} className="flex flex-col gap-3 border-t p-3">
          {children}
        </div>
      )}
    </li>
  )
}

function IconAction({ label, disabled, onClick, children }: { label: string; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="flex size-7 shrink-0 items-center justify-center rounded text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-35 [&_svg]:size-3.5"
    >
      {children}
    </button>
  )
}
