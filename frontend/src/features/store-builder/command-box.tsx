import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { SearchIcon } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { commandSections, GROUP_TITLES, readRecent, rememberRecent, type CommandItem } from './command-model'

/*
 * B12 Ctrl/Cmd+K command box: one search over elements to add, templates, things on this page,
 * other pages and the editor's actions. ARIA combobox + listbox: focus stays in the field, the
 * arrows move the active option (aria-activedescendant), Enter runs it, Esc closes.
 */

export function CommandBox({ open, onOpenChange, items }: { open: boolean; onOpenChange: (open: boolean) => void; items: readonly CommandItem[] }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="top-[15%] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-xl" showCloseButton={false} data-testid="command-box">
        <DialogTitle className="sr-only">Find or do anything</DialogTitle>
        <DialogDescription className="sr-only">Type to search elements, templates, things on this page, other pages and actions. Use the arrow keys and Enter.</DialogDescription>
        {open && <CommandSearch items={items} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  )
}

function CommandSearch({ items, onDone }: { items: readonly CommandItem[]; onDone: () => void }) {
  const [query, setQuery] = useState('')
  const [recent] = useState(readRecent)
  const [active, setActive] = useState(0)
  const ids = useId()
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  // Opened by a key pressed in the canvas, the iframe may still hold the focus for a moment: take it.
  useEffect(() => {
    const take = () => {
      if (document.activeElement !== inputRef.current) {
        window.focus()
        inputRef.current?.focus()
      }
    }
    const frame = requestAnimationFrame(take)
    const timer = setTimeout(take, 120)
    return () => {
      cancelAnimationFrame(frame)
      clearTimeout(timer)
    }
  }, [])
  const sections = useMemo(() => commandSections(items, query, recent), [items, query, recent])
  const flat = useMemo(() => sections.flatMap((section) => section.items.map((item) => ({ item, key: `${section.group}:${item.id}` }))), [sections])
  const current = Math.min(active, Math.max(0, flat.length - 1))
  const optionId = (index: number) => `${ids}-option-${index}`

  const move = (index: number) => {
    const next = flat.length === 0 ? 0 : (index + flat.length) % flat.length
    setActive(next)
    // Keep the active option in view (DOM order = list order).
    requestAnimationFrame(() => document.getElementById(optionId(next))?.scrollIntoView({ block: 'nearest' }))
  }

  const run = (item: CommandItem | undefined) => {
    if (!item || item.disabled) return
    if (!item.id.startsWith('goto:')) rememberRecent(item.id)
    onDone()
    // After the dialog has closed (focus goes back first; then the action may open its own dialog).
    setTimeout(() => item.run(), 0)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      move(current + 1)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      move(current - 1)
    } else if (event.key === 'Home' && event.ctrlKey) {
      event.preventDefault()
      move(0)
    } else if (event.key === 'End' && event.ctrlKey) {
      event.preventDefault()
      move(flat.length - 1)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      run(flat[current]?.item)
    }
  }

  const listId = `${ids}-list`
  // Where each section's options start in the flat list.
  const starts = sections.map((_, i) => sections.slice(0, i).reduce((sum, section) => sum + section.items.length, 0))
  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-2 border-b px-3">
        <SearchIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <input
          ref={inputRef}
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={flat.length > 0 ? optionId(current) : undefined}
          aria-label="Find an element, a page or an action"
          placeholder="Add an element, go to something, open a page… (English or বাংলা)"
          autoFocus
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setActive(0)
          }}
          onKeyDown={onKeyDown}
          className="h-12 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          data-testid="command-input"
        />
      </div>
      <div ref={listRef} id={listId} role="listbox" aria-label="Results" className="max-h-[60vh] overflow-y-auto p-1">
        {flat.length === 0 && (
          <p role="presentation" className="px-3 py-6 text-center text-sm text-muted-foreground">
            Nothing matches “{query}”.
          </p>
        )}
        {sections.map((section, sectionIndex) => {
          const headingId = `${ids}-group-${section.group}`
          return (
            <div key={section.group} role="group" aria-labelledby={headingId} className="py-1">
              <div id={headingId} role="presentation" className="px-2 py-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                {GROUP_TITLES[section.group]}
              </div>
              {section.items.map((item, itemIndex) => {
                const mine = starts[sectionIndex]! + itemIndex
                const selected = mine === current
                return (
                  <div
                    key={`${section.group}:${item.id}`}
                    id={optionId(mine)}
                    role="option"
                    aria-selected={selected}
                    aria-disabled={item.disabled ? true : undefined}
                    data-testid={`command-${item.id}`}
                    onMouseMove={() => mine !== current && setActive(mine)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => run(item)}
                    className={cn('flex cursor-pointer flex-col rounded-md px-2 py-1.5 text-sm', selected && 'bg-accent text-accent-foreground', item.disabled && 'cursor-not-allowed opacity-60')}
                  >
                    <span className="truncate">{item.label}</span>
                    {(item.disabled || item.hint) && <span className="truncate text-xs text-muted-foreground">{item.disabled ?? item.hint}</span>}
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>
      <p className="border-t px-3 py-1.5 text-xs text-muted-foreground" aria-hidden>
        ↑ ↓ to choose · Enter to run · Esc to close
      </p>
    </div>
  )
}
