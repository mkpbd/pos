import { useId, useState, type ReactNode } from 'react'
import { ChevronDownIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ProductLayout } from '../types'
import { detailSectionId } from './product-layout'
import { Tabs } from './product-tabs'

export type DetailSection = { id: string; label: string; content: ReactNode }

/**
 * The product's details (description, specifications, reviews, questions) in the theme's layout
 * (P1b): `tabs` (today's look), `accordion` (each part opens on its own; the first starts open) or
 * `stacked` (one after another, each with its heading). `active` is the selected tab; each new
 * `request` (e.g. the rating link opening the reviews) opens the `active` part of the accordion.
 */
export function ProductDetails({
  sections,
  mode,
  label,
  active,
  request = 0,
  onActivate,
}: {
  sections: DetailSection[]
  mode: ProductLayout['details']
  label: string
  active?: string
  request?: number
  onActivate: (id: string) => void
}) {
  if (sections.length === 0) return null
  if (mode === 'accordion') return <Accordion sections={sections} active={active} request={request} onActivate={onActivate} />
  if (mode === 'stacked') {
    return (
      <div className="flex flex-col divide-y" data-testid="product-details" data-mode="stacked">
        {sections.map((section) => (
          <StackedSection key={section.id} section={section} />
        ))}
      </div>
    )
  }
  return (
    <div data-testid="product-details" data-mode="tabs">
      <Tabs tabs={sections} label={label} selectedId={active} onSelect={onActivate} />
    </div>
  )
}

function StackedSection({ section }: { section: DetailSection }) {
  const headingId = useId()
  return (
    <section id={detailSectionId(section.id)} aria-labelledby={headingId} className="scroll-mt-24 py-6 first:pt-0 last:pb-0">
      <h2 id={headingId} className="mb-4 text-xl font-extrabold lg:text-2xl">
        {section.label}
      </h2>
      {section.content}
    </section>
  )
}

/** WAI-ARIA accordion: a heading with a button (aria-expanded) per part; parts mount when first opened. */
function Accordion({ sections, active, request, onActivate }: { sections: DetailSection[]; active?: string; request: number; onActivate: (id: string) => void }) {
  const baseId = useId()
  const [open, setOpen] = useState<string[]>(() => [sections[0]!.id])
  // A part asked for from outside (the rating link) opens as well, every time it is asked for.
  const [handled, setHandled] = useState(request)
  if (request !== handled) {
    setHandled(request)
    if (active && !open.includes(active)) setOpen([...open, active])
  }

  const toggle = (id: string) => {
    const opening = !open.includes(id)
    setOpen(opening ? [...open, id] : open.filter((item) => item !== id))
    if (opening) onActivate(id)
  }

  return (
    <div className="flex flex-col divide-y" data-testid="product-details" data-mode="accordion">
      {sections.map((section, i) => {
        const expanded = open.includes(section.id)
        const buttonId = `${baseId}-button-${i}`
        const panelId = `${baseId}-panel-${i}`
        return (
          <div key={section.id} id={detailSectionId(section.id)} className="scroll-mt-24">
            <h2 className="text-lg font-extrabold">
              <button
                type="button"
                id={buttonId}
                aria-expanded={expanded}
                aria-controls={panelId}
                onClick={() => toggle(section.id)}
                className="flex min-h-14 w-full items-center justify-between gap-4 py-3 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sf-accent"
              >
                {section.label}
                <ChevronDownIcon aria-hidden className={cn('size-5 shrink-0 transition-transform motion-reduce:transition-none', expanded && 'rotate-180')} />
              </button>
            </h2>
            <div id={panelId} role="region" aria-labelledby={buttonId} hidden={!expanded} className="pb-6">
              {expanded && section.content}
            </div>
          </div>
        )
      })}
    </div>
  )
}
