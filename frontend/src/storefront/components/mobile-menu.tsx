import { useId, useState } from 'react'
import { ChevronDownIcon, MenuIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { cn } from '@/lib/utils'
import type { MenuNode } from '../types'
import { MenuLink } from './menu-link'

/**
 * Below the desktop breakpoint: a drawer from the left with the menu as an accordion.
 * Choosing a link closes the drawer.
 */
export function MobileMenu({ storeName, items }: { storeName: string; items: MenuNode[] }) {
  const [open, setOpen] = useState(false)

  if (items.length === 0) return null

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open menu">
          <MenuIcon aria-hidden className="size-6" />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-80 max-w-[85vw] gap-0 p-0">
        <SheetHeader className="border-b">
          <SheetTitle className="font-heading text-lg text-sf-heading">{storeName}</SheetTitle>
          <SheetDescription className="sr-only">Site navigation</SheetDescription>
        </SheetHeader>
        <nav aria-label="Mobile" className="overflow-y-auto">
          <MobileTree items={items} depth={0} onNavigate={() => setOpen(false)} />
        </nav>
      </SheetContent>
    </Sheet>
  )
}

function MobileTree({ items, depth, onNavigate }: { items: MenuNode[]; depth: number; onNavigate: () => void }) {
  return (
    <ul className={cn(depth > 0 && 'bg-sf-canvas/60')}>
      {items.map((item) => (
        <MobileItem key={item.id} item={item} depth={depth} onNavigate={onNavigate} />
      ))}
    </ul>
  )
}

function MobileItem({ item, depth, onNavigate }: { item: MenuNode; depth: number; onNavigate: () => void }) {
  const [expanded, setExpanded] = useState(false)
  const childrenId = useId()
  const hasChildren = item.children.length > 0

  return (
    <li className="border-b last:border-b-0">
      <div className="flex items-center">
        <MenuLink
          url={item.url}
          newTab={item.open_in_new_tab}
          onClick={onNavigate}
          className={cn('flex-1 py-3 pr-2 text-sm font-medium text-sf-heading', depth === 0 && 'uppercase')}
          style={{ paddingLeft: `${1 + depth}rem` }}
        >
          {item.label}
        </MenuLink>
        {hasChildren && (
          <button
            type="button"
            className="flex size-11 items-center justify-center text-sf-text"
            aria-expanded={expanded}
            aria-controls={childrenId}
            aria-label={`${item.label} submenu`}
            onClick={() => setExpanded((value) => !value)}
          >
            <ChevronDownIcon aria-hidden className={cn('size-4 transition-transform', expanded && 'rotate-180')} />
          </button>
        )}
      </div>
      {hasChildren && (
        <div id={childrenId} hidden={!expanded}>
          <MobileTree items={item.children} depth={depth + 1} onNavigate={onNavigate} />
        </div>
      )}
    </li>
  )
}
