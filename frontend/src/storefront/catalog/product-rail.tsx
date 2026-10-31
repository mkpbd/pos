import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * A horizontally scrolling row (product and category carousels) inside a labelled section.
 * Native scrolling with snap
 * points, so touch, trackpad and keyboard scrolling work; the arrow buttons page by the
 * visible width and are disabled at either end.
 */
export function Rail({ label, children, itemClassName, count }: { label: string; children: ReactNode[]; itemClassName?: string; count: number }) {
  const trackRef = useRef<HTMLUListElement>(null)
  const [edges, setEdges] = useState({ start: true, end: count <= 1 })

  const update = useCallback(() => {
    const el = trackRef.current
    if (!el) return
    setEdges({ start: el.scrollLeft <= 1, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 1 })
  }, [])

  useEffect(() => {
    update()
    const el = trackRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [update, count])

  const page = (direction: 1 | -1) => {
    const el = trackRef.current
    if (!el) return
    el.scrollBy?.({ left: direction * el.clientWidth * 0.9, behavior: 'smooth' })
  }

  const arrow = 'grid size-10 place-items-center rounded-full border bg-sf-surface text-sf-heading shadow-sm transition hover:bg-sf-accent hover:text-sf-accent-foreground disabled:pointer-events-none disabled:opacity-40'

  return (
    <div role="group" aria-roledescription="carousel" aria-label={label} className="relative">
      <ul
        ref={trackRef}
        onScroll={update}
        className="-mx-1 flex snap-x snap-mandatory gap-5 overflow-x-auto scroll-smooth px-1 pb-3 [scrollbar-width:thin] motion-reduce:scroll-auto"
      >
        {children.map((child, i) => (
          <li key={i} className={cn('shrink-0 snap-start', itemClassName)} aria-roledescription="slide" aria-label={`${i + 1} of ${count}`}>
            {child}
          </li>
        ))}
      </ul>
      {!(edges.start && edges.end) && (
        <div className="mt-3 flex justify-end gap-2">
          <button type="button" className={arrow} onClick={() => page(-1)} disabled={edges.start} aria-label={`Previous: ${label}`}>
            <ChevronLeftIcon aria-hidden className="size-5" />
          </button>
          <button type="button" className={arrow} onClick={() => page(1)} disabled={edges.end} aria-label={`Next: ${label}`}>
            <ChevronRightIcon aria-hidden className="size-5" />
          </button>
        </div>
      )}
    </div>
  )
}

/** Card widths for product rails: one and a bit on phones, then 2, 3 and 4 visible. */
export const PRODUCT_RAIL_ITEM = 'w-[72%] sm:w-[calc((100%-1.25rem)/2)] md:w-[calc((100%-2.5rem)/3)] lg:w-[calc((100%-3.75rem)/4)]'
