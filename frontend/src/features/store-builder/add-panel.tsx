import { useMemo, useState } from 'react'
import { useDraggable } from '@dnd-kit/core'
import { SearchIcon } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { ElementsMetadata } from './api'
import { ELEMENT_HINTS, GROUP_LABELS, GROUP_ORDER } from './catalogue'
import { useCommands } from './commands'
import type { Dragged } from './drop-targets'
import { ElementIcon } from './element-icon'

type TypeMeta = ElementsMetadata['types'][number]

function CatalogueItem({ meta }: { meta: TypeMeta }) {
  const commands = useCommands()
  const dragged: Dragged = { kind: 'new', type: meta.type }
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `add:${meta.type}`, data: { dragged } })
  // Keyboard users add with Enter / Space (a click); dragging is for the pointer.
  const { onKeyDown: _keyboardDrag, ...pointerListeners } = listeners ?? {}
  const hint = ELEMENT_HINTS[meta.type] ?? meta.label
  return (
    <li>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            ref={setNodeRef}
            type="button"
            {...attributes}
            {...pointerListeners}
            aria-roledescription="draggable element"
            aria-label={`Add ${meta.label}`}
            data-testid={`add-${meta.type}`}
            onClick={() => void commands.insert(meta.type)}
            className={cn(
              'flex w-full cursor-grab flex-col items-center gap-1.5 rounded-md border bg-background p-2.5 text-center text-xs font-medium transition-colors hover:border-primary hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none active:cursor-grabbing',
              isDragging && 'opacity-50',
            )}
          >
            <ElementIcon type={meta.type} className="size-5 text-muted-foreground" />
            <span className="leading-tight">{meta.label}</span>
          </button>
        </TooltipTrigger>
        <TooltipContent side="right">{hint}</TooltipContent>
      </Tooltip>
    </li>
  )
}

/** The element catalogue: grouped, searchable; drag onto the canvas or click to insert. */
export function AddPanel({ registry }: { registry: ElementsMetadata }) {
  const [query, setQuery] = useState('')
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase()
    const matches = registry.types.filter((meta) => !q || meta.label.toLowerCase().includes(q) || (ELEMENT_HINTS[meta.type] ?? '').toLowerCase().includes(q))
    return GROUP_ORDER.map((group) => ({ group, items: matches.filter((meta) => meta.group === group) })).filter((entry) => entry.items.length > 0)
  }, [query, registry.types])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="relative p-3">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search elements" aria-label="Search elements" className="pl-8" />
      </div>
      <p className="px-3 pb-2 text-xs text-muted-foreground">Drag an element onto the page, or click it to add it after the selection.</p>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        {groups.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">No element matches “{query}”.</p>}
        {groups.map(({ group, items }) => (
          <section key={group} aria-labelledby={`add-group-${group}`} className="mb-4">
            <h3 id={`add-group-${group}`} className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              {GROUP_LABELS[group]}
            </h3>
            <ul className="grid grid-cols-2 gap-2">
              {items.map((meta) => (
                <CatalogueItem key={meta.type} meta={meta} />
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  )
}
