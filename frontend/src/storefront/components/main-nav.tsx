import { useEffect, useId, useRef, useState, type FocusEvent, type KeyboardEvent } from 'react'
import { ChevronDownIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useLocale } from '../i18n/locale'
import type { MenuNode } from '../types'
import { MediaImage } from './media-image'
import { MenuLink } from './menu-link'

/**
 * How the bar looks per header variant: `bar` (standard header — accent bar, uppercase),
 * `centered` (airy row under a centred brand), `commerce` (dark full-width bar).
 */
export type NavAppearance = 'bar' | 'centered' | 'commerce'

const APPEARANCE: Record<NavAppearance, { nav: string; list: string; link: string; toggle: string }> = {
  bar: {
    nav: 'bg-sf-accent text-sf-accent-foreground',
    list: '',
    link: 'flex items-center px-4 py-4 text-sm font-semibold tracking-wide uppercase transition-colors hover:bg-black/10 focus-visible:bg-black/10 focus-visible:outline-none',
    toggle: 'flex items-center pr-3 pl-1 transition-colors hover:bg-black/10 focus-visible:bg-black/10 focus-visible:outline-none',
  },
  centered: {
    nav: 'border-t bg-sf-surface text-sf-heading',
    list: 'justify-center gap-x-2',
    link: 'flex items-center px-4 py-3.5 text-[0.95rem] font-medium tracking-wide transition-colors hover:text-sf-accent focus-visible:text-sf-accent focus-visible:underline focus-visible:underline-offset-8 focus-visible:outline-none',
    toggle: 'flex items-center pr-3 pl-0.5 transition-colors hover:text-sf-accent focus-visible:text-sf-accent focus-visible:outline-none',
  },
  commerce: {
    nav: 'bg-sf-heading text-sf-surface',
    list: '',
    link: 'flex items-center px-4 py-3.5 text-[0.8rem] font-bold tracking-wider uppercase transition-colors hover:bg-white/10 focus-visible:bg-white/15 focus-visible:outline-none',
    toggle: 'flex items-center pr-3 pl-1 transition-colors hover:bg-white/10 focus-visible:bg-white/15 focus-visible:outline-none',
  },
}

const MEGA_GRID: Record<number, string> = {
  2: 'grid-cols-2',
  3: 'grid-cols-3',
  4: 'grid-cols-4',
}

/**
 * Desktop navigation (disclosure pattern): every top-level item is a link; items with
 * children get a separate toggle button. Panels open on hover and with the toggle
 * (Enter/Space), close on Escape (focus returns to the toggle) and when focus leaves.
 * Mega items open a full-width panel: one column per child, grandchildren as links.
 */
export function MainNav({ items, appearance = 'bar' }: { items: MenuNode[]; appearance?: NavAppearance }) {
  const [openId, setOpenId] = useState<string | null>(null)
  const navRef = useRef<HTMLElement>(null)
  const { t } = useLocale()

  // Navigating (route change or a click on a link) closes any open panel.
  useEffect(() => {
    const close = (event: MouseEvent) => {
      if ((event.target as Element | null)?.closest('a')) setOpenId(null)
    }
    const nav = navRef.current
    nav?.addEventListener('click', close)
    return () => nav?.removeEventListener('click', close)
  }, [])

  if (items.length === 0) return null

  return (
    <nav ref={navRef} aria-label={t('shell.nav.main')} className={cn('relative hidden lg:block', APPEARANCE[appearance].nav)} data-appearance={appearance}>
      <ul className={cn('mx-auto flex max-w-sf flex-wrap items-stretch px-4', APPEARANCE[appearance].list)}>
        {items.map((item) => (
          <NavItem
            key={item.id}
            item={item}
            appearance={appearance}
            open={openId === item.id}
            onOpenChange={(open) => setOpenId((current) => (open ? item.id : current === item.id ? null : current))}
          />
        ))}
      </ul>
    </nav>
  )
}

function NavItem({ item, appearance, open, onOpenChange }: { item: MenuNode; appearance: NavAppearance; open: boolean; onOpenChange: (open: boolean) => void }) {
  const panelId = useId()
  const toggleRef = useRef<HTMLButtonElement>(null)
  const { t } = useLocale()
  const hasPanel = item.children.length > 0 || (item.is_mega && item.image !== null)

  const linkClass = APPEARANCE[appearance].link

  if (!hasPanel) {
    return (
      <li className="flex">
        <MenuLink url={item.url} newTab={item.open_in_new_tab} className={linkClass}>
          {item.label}
        </MenuLink>
      </li>
    )
  }

  const onBlur = (event: FocusEvent<HTMLLIElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onOpenChange(false)
  }
  const onKeyDown = (event: KeyboardEvent<HTMLLIElement>) => {
    if (event.key === 'Escape' && open) {
      event.stopPropagation()
      onOpenChange(false)
      toggleRef.current?.focus()
    }
  }

  return (
    <li
      className={cn('flex', !item.is_mega && 'relative')}
      onMouseEnter={() => onOpenChange(true)}
      onMouseLeave={() => onOpenChange(false)}
      onBlur={onBlur}
      onKeyDown={onKeyDown}
    >
      <MenuLink url={item.url} newTab={item.open_in_new_tab} className={cn(linkClass, 'pr-1')}>
        {item.label}
      </MenuLink>
      <button
        ref={toggleRef}
        type="button"
        className={APPEARANCE[appearance].toggle}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={t('common.submenu', { label: item.label })}
        // A pointer has already opened the panel by hovering, so a click keeps it open;
        // keyboard activation (detail 0) toggles.
        onClick={(event) => onOpenChange(event.detail === 0 ? !open : true)}
      >
        <ChevronDownIcon aria-hidden className={cn('size-4 transition-transform', open && 'rotate-180')} />
      </button>

      {item.is_mega ? (
        <MegaPanel id={panelId} item={item} open={open} />
      ) : (
        <div
          id={panelId}
          hidden={!open}
          className="absolute top-full left-0 z-50 min-w-60 rounded-b-sf-card border border-t-0 bg-sf-surface py-2 text-sf-text shadow-lg"
        >
          <SubmenuList items={item.children} />
        </div>
      )}
    </li>
  )
}

function SubmenuList({ items }: { items: MenuNode[] }) {
  return (
    <ul>
      {items.map((child) => (
        <li key={child.id}>
          <MenuLink
            url={child.url}
            newTab={child.open_in_new_tab}
            className="block px-4 py-2 text-sm transition-colors hover:bg-sf-canvas hover:text-sf-accent focus-visible:bg-sf-canvas focus-visible:outline-none"
          >
            {child.label}
          </MenuLink>
          {child.children.length > 0 && (
            <ul className="pb-1 pl-4">
              {child.children.map((grandchild) => (
                <li key={grandchild.id}>
                  <MenuLink
                    url={grandchild.url}
                    newTab={grandchild.open_in_new_tab}
                    className="block px-4 py-1.5 text-sm text-sf-text/90 transition-colors hover:text-sf-accent focus-visible:text-sf-accent focus-visible:outline-none"
                  >
                    {grandchild.label}
                  </MenuLink>
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ul>
  )
}

function MegaPanel({ id, item, open }: { id: string; item: MenuNode; open: boolean }) {
  const columns = Math.min(4, Math.max(2, item.mega_columns ?? 4))

  return (
    <div id={id} hidden={!open} className="absolute inset-x-0 top-full z-50 border-t bg-sf-surface text-sf-text shadow-lg" data-testid="mega-panel">
      <div className="mx-auto flex max-w-sf gap-8 px-6 py-6">
        <ul className={cn('grid flex-1 gap-x-8 gap-y-6', MEGA_GRID[columns])}>
          {item.children.map((column) => (
            <li key={column.id}>
              <MenuLink
                url={column.url}
                newTab={column.open_in_new_tab}
                className="font-heading text-base font-bold text-sf-heading transition-colors hover:text-sf-accent focus-visible:text-sf-accent focus-visible:outline-none"
              >
                {column.label}
              </MenuLink>
              {column.children.length > 0 && (
                <ul className="mt-2 space-y-1.5">
                  {column.children.map((link) => (
                    <li key={link.id}>
                      <MenuLink
                        url={link.url}
                        newTab={link.open_in_new_tab}
                        className="text-sm transition-colors hover:text-sf-accent focus-visible:text-sf-accent focus-visible:outline-none"
                      >
                        {link.label}
                      </MenuLink>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
        {item.image && (
          <MediaImage media={item.image} sizes="18rem" className="hidden w-72 shrink-0 self-start rounded-sf-card object-cover xl:block" />
        )}
      </div>
    </div>
  )
}
