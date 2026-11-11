import { cn } from '@/lib/utils'
import type { StoreSection } from '../types'

/** A section's optional title and subtitle, centred above its content. */
export function SectionHeading({ section, className, color }: { section: Pick<StoreSection, 'title' | 'subtitle'>; className?: string; color?: string }) {
  if (!section.title && !section.subtitle) return null

  return (
    <header className={cn('mb-8 text-center', className)} style={color ? { color } : undefined}>
      {section.title && <h2 className="sf-heading-case text-3xl font-extrabold lg:text-4xl" style={color ? { color } : undefined}>{section.title}</h2>}
      {section.subtitle && <p className="mx-auto mt-2 max-w-2xl">{section.subtitle}</p>}
    </header>
  )
}
