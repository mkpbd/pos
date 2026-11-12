import { useMemo, useState } from 'react'
import { useDraggable } from '@dnd-kit/core'
import { SearchIcon } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { ElementsMetadata } from './api'
import { ELEMENT_HINTS, GROUP_LABELS, GROUP_ORDER } from './catalogue'
import { CUSTOM_HTML_DENIED, useCommands } from './commands'
import { allowedIn, type ElementContext } from './document-kind'
import type { Dragged } from './drop-targets'
import { ElementIcon } from './element-icon'

type TypeMeta = ElementsMetadata['types'][number]

function CatalogueItem({ meta, disabledReason }: { meta: TypeMeta; disabledReason?: string }) {
  const commands = useCommands()
  const dragged: Dragged = { kind: 'new', type: meta.type }
  const disabled = disabledReason !== undefined
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `add:${meta.type}`, data: { dragged }, disabled })
  // Keyboard users add with Enter / Space (a click); dragging is for the pointer.
  const { onKeyDown: _keyboardDrag, ...pointerListeners } = listeners ?? {}
  const hint = disabledReason ?? ELEMENT_HINTS[meta.type] ?? meta.label
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
            aria-disabled={disabled || undefined}
            data-testid={`add-${meta.type}`}
            onClick={() => void commands.insert(meta.type)}
            className={cn(
              'flex w-full cursor-grab flex-col items-center gap-1.5 rounded-md border bg-background p-2.5 text-center text-xs font-medium transition-colors hover:border-primary hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none active:cursor-grabbing',
              isDragging && 'opacity-50',
              disabled && 'cursor-not-allowed opacity-50 hover:border-border hover:bg-background',
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

/**
 * The element catalogue: grouped, searchable; drag onto the canvas or click to insert. B4: only
 * the types the document may hold (`allowed_in` of its context); custom HTML is greyed out for
 * people without `storefront.custom_html`.
 */
export function AddPanel({ registry, context = 'page', canCustomHtml = true }: { registry: ElementsMetadata; context?: ElementContext; canCustomHtml?: boolean }) {
  const [query, setQuery] = useState('')
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase()
    const matches = registry.types.filter((meta) => allowedIn(meta, context) && (!q || meta.label.toLowerCase().includes(q) || (ELEMENT_HINTS[meta.type] ?? '').toLowerCase().includes(q)))
    // A group the editor doesn't know goes under Content rather than disappearing.
    const groupOf = (meta: TypeMeta) => ((GROUP_ORDER as string[]).includes(meta.group) ? meta.group : 'content')
    return GROUP_ORDER.map((group) => ({ group, items: matches.filter((meta) => groupOf(meta) === group) })).filter((entry) => entry.items.length > 0)
  }, [query, registry.types, context])

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
                <CatalogueItem key={meta.type} meta={meta} disabledReason={meta.type === 'custom_html' && !canCustomHtml ? CUSTOM_HTML_DENIED : undefined} />
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  )
}
