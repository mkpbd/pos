import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

export type TabItem = { id: string; label: string; content: ReactNode }

/**
 * Tabs (WAI-ARIA tabs pattern, automatic activation): Arrow keys, Home and End move between
 * tabs; only the selected tab is in the tab order.
 */
export function Tabs({ tabs, label, className, tabListClassName }: { tabs: TabItem[]; label: string; className?: string; tabListClassName?: string }) {
  const baseId = useId()
  const [selected, setSelected] = useState(0)
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const current = Math.min(selected, tabs.length - 1)

  if (tabs.length === 0) return null

  const focus = (i: number) => {
    const next = (i + tabs.length) % tabs.length
    setSelected(next)
    refs.current[next]?.focus()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const moves: Record<string, number> = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }
    const target = moves[event.key]
    if (target === undefined) return
    event.preventDefault()
    focus(target)
  }

  return (
    <div className={className}>
      <div role="tablist" aria-label={label} className={cn('flex flex-wrap gap-2', tabListClassName)}>
        {tabs.map((tab, i) => (
          <button
            key={tab.id}
            ref={(el) => {
              refs.current[i] = el
            }}
            type="button"
            role="tab"
            id={`${baseId}-tab-${i}`}
            aria-selected={i === current}
            aria-controls={`${baseId}-panel-${i}`}
            tabIndex={i === current ? 0 : -1}
            onClick={() => setSelected(i)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={cn(
              'rounded-sf-button px-5 py-2 text-sm font-bold tracking-wide uppercase transition',
              i === current ? 'bg-sf-accent text-sf-accent-foreground' : 'bg-sf-canvas text-sf-heading hover:bg-sf-border',
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {tabs.map((tab, i) => (
        <div key={tab.id} role="tabpanel" id={`${baseId}-panel-${i}`} aria-labelledby={`${baseId}-tab-${i}`} hidden={i !== current} tabIndex={0} className="pt-6 focus-visible:outline-2 focus-visible:outline-sf-accent">
          {i === current && tab.content}
        </div>
      ))}
    </div>
  )
}
