import { useState } from 'react'
import { Link, useLocation } from 'react-router'
import { SearchIcon, XIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useStorefront } from '../api'
import { HeaderSearch } from './header-search'
import { MainNav } from './main-nav'
import { MediaImage } from './media-image'
import { MobileMenu } from './mobile-menu'

/**
 * Logo row with the product search over the accent-coloured navigation bar
 * (UI_REFERENCE_ANALYSIS §4). On small screens the search opens below the logo row from a
 * toggle. Account and cart join the header in the phases that ship them.
 */
export function SiteHeader() {
  const { store, theme, menus } = useStorefront()
  const mainItems = menus.main?.items ?? []
  const mobileItems = menus.mobile?.items ?? mainItems
  const { pathname } = useLocation()
  // The page the mobile search row was opened on: another page closes it.
  const [searchOpenOn, setSearchOpenOn] = useState<string | null>(null)
  const searchOpen = searchOpenOn === pathname
  const setSearchOpen = (open: boolean) => setSearchOpenOn(open ? pathname : null)

  return (
    <header className={cn('z-40 bg-sf-surface shadow-sm', theme.layout.sticky_header && 'sticky top-0')} data-testid="site-header">
      <div className="mx-auto flex max-w-sf items-center justify-between gap-4 px-4 py-3 lg:gap-10 lg:py-5">
        <Link to="/" className="flex min-w-0 items-center" aria-label={`${store.name} home`}>
          {theme.logo ? (
            <MediaImage
              media={theme.logo}
              alt={store.name}
              sizes="(min-width: 1024px) 220px, 160px"
              loading="eager"
              className="h-10 w-auto max-w-40 object-contain lg:h-14 lg:max-w-56"
            />
          ) : (
            <span className="truncate font-heading text-2xl font-extrabold text-sf-accent lg:text-3xl">{store.name}</span>
          )}
        </Link>
        <HeaderSearch className="hidden max-w-xl flex-1 lg:block" />
        <div className="flex items-center gap-1 lg:hidden">
          <button
            type="button"
            className="grid size-10 place-items-center rounded-md text-sf-heading hover:bg-sf-canvas"
            aria-expanded={searchOpen}
            aria-controls="mobile-search"
            aria-label={searchOpen ? 'Close search' : 'Open search'}
            onClick={() => setSearchOpen(!searchOpen)}
          >
            {searchOpen ? <XIcon aria-hidden className="size-6" /> : <SearchIcon aria-hidden className="size-6" />}
          </button>
          <MobileMenu storeName={store.name} items={mobileItems} />
        </div>
      </div>
      <div id="mobile-search" hidden={!searchOpen} className="border-t px-4 py-3 lg:hidden">
        {searchOpen && <HeaderSearch autoFocus onDone={() => setSearchOpen(false)} />}
      </div>
      <MainNav items={mainItems} />
    </header>
  )
}
