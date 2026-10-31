import { NavLink } from 'react-router'
import { useCan } from '@/features/auth/use-auth'
import { cn } from '@/lib/utils'
import type { SectionTab } from '@/features/inventory/sections'

/** Secondary navigation inside a module area (rendered as links, so every view has its own URL). */
export function SectionTabs({ tabs, label }: { tabs: SectionTab[]; label: string }) {
  const can = useCan()

  return (
    <nav aria-label={label} className="flex gap-1 overflow-x-auto border-b">
      {tabs.filter((t) => !t.permission || can(t.permission)).map((t) => (
        <NavLink
          key={t.to}
          to={t.to}
          end
          className={({ isActive }) =>
            cn('-mb-px border-b-2 px-3 py-2 text-sm whitespace-nowrap transition-colors', isActive ? 'border-primary font-medium text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground')
          }
        >
          {t.label}
        </NavLink>
      ))}
    </nav>
  )
}
