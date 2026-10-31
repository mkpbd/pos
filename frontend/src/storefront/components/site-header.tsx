import { Link } from 'react-router'
import { cn } from '@/lib/utils'
import { useStorefront } from '../api'
import { MainNav } from './main-nav'
import { MediaImage } from './media-image'
import { MobileMenu } from './mobile-menu'

/**
 * Logo row over the accent-coloured navigation bar (UI_REFERENCE_ANALYSIS §4). Search,
 * account and cart join the header in the phases that ship them.
 */
export function SiteHeader() {
  const { store, theme, menus } = useStorefront()
  const mainItems = menus.main?.items ?? []
  const mobileItems = menus.mobile?.items ?? mainItems

  return (
    <header className={cn('z-40 bg-sf-surface shadow-sm', theme.layout.sticky_header && 'sticky top-0')} data-testid="site-header">
      <div className="mx-auto flex max-w-sf items-center justify-between gap-4 px-4 py-3 lg:py-5">
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
        <MobileMenu storeName={store.name} items={mobileItems} />
      </div>
      <MainNav items={mainItems} />
    </header>
  )
}
