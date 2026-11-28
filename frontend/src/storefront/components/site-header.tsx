import { useState } from 'react'
import { Link, useLocation } from 'react-router'
import { SearchIcon, XIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useStorefront } from '../api'
import { useLocale } from '../i18n/locale'
import { isBuilderPayload } from '../builder/payload'
import { PageRenderer } from '../builder/page-renderer'
import { PhoneHeader } from '../builder/phone-header'
import { useStoreLayout } from '../theme'
import type { BuilderPage } from '../builder/types'
import { HeaderActions } from './header-actions'
import { HeaderSearch } from './header-search'
import { LanguageSwitcher } from './language-switcher'
import { MainNav } from './main-nav'
import { MediaImage } from './media-image'
import { MobileMenu } from './mobile-menu'
import { SearchPanel } from './search-panel'
import { useIsDesktop, useIsTabletUp } from './use-media-query'

/**
 * The header in the theme's `header_style`. The centered and commerce variants are desktop
 * layouts: below the `lg` breakpoint every store uses the standard header with its drawer.
 */
export function SiteHeader() {
  const { header_style: style } = useStoreLayout()
  const { builder } = useStorefront()
  const desktop = useIsDesktop()
  const tabletUp = useIsTabletUp()
  // B4: a header designed in the store builder; B22a: below 768 px in its phone layout.
  if (isBuilderPayload(builder?.header)) return <BuilderHeader page={builder.header} phone={!tabletUp} />
  if (desktop && style === 'centered') return <CenteredHeader />
  if (desktop && style === 'commerce') return <CommerceHeader />
  return <StandardHeader nameClassName={MOBILE_NAME[style]} />
}

/**
 * The store name (no logo) on small screens, styled like the desktop variant's brand so a preset keeps
 * its character on phones: accent-coloured (standard), quiet serif-style (centered), bold UPPERCASE (commerce).
 */
const MOBILE_NAME = {
  standard: 'font-extrabold text-sf-accent',
  centered: 'font-semibold tracking-wide text-sf-heading',
  // A notch smaller on phones: capitals run wide, and the name should not be cut off next to five icons.
  commerce: 'font-extrabold tracking-tight text-sf-heading uppercase max-sm:text-lg',
} as const

/**
 * Logo row with the product search over the accent-coloured navigation bar
 * (UI_REFERENCE_ANALYSIS §4). On small screens the search opens below the logo row from a
 * toggle. Account, wishlist and cart (with counts) sit at the right on every screen size.
 */
function StandardHeader({ nameClassName = MOBILE_NAME.standard }: { nameClassName?: string }) {
  const { store, theme, menus } = useStorefront()
  const { t } = useLocale()
  const mainItems = menus.main?.items ?? []
  const mobileItems = menus.mobile?.items ?? mainItems
  const { pathname } = useLocation()
  // The page the mobile search row was opened on: another page closes it.
  const [searchOpenOn, setSearchOpenOn] = useState<string | null>(null)
  const searchOpen = searchOpenOn === pathname
  const setSearchOpen = (open: boolean) => setSearchOpenOn(open ? pathname : null)

  return (
    <header className={cn('z-40 bg-sf-surface shadow-sm', theme.layout.sticky_header && 'sticky top-0')} data-testid="site-header">
      <div className="mx-auto flex max-w-sf items-center justify-between gap-2 px-4 py-3 sm:gap-4 lg:gap-10 lg:py-5">
        <Link to="/" className="flex min-w-0 items-center" aria-label={t('common.storeHome', { store: store.name })}>
          {theme.logo ? (
            <MediaImage
              media={theme.logo}
              alt={store.name}
              sizes="(min-width: 1024px) 220px, 160px"
              loading="eager"
              className="h-10 w-auto max-w-28 object-contain sm:max-w-40 lg:h-14 lg:max-w-56"
            />
          ) : (
            <span className={cn('truncate font-heading text-xl sm:text-2xl lg:text-3xl', nameClassName)}>{store.name}</span>
          )}
        </Link>
        <HeaderSearch className="hidden max-w-xl flex-1 lg:block" />
        <div className="flex shrink-0 items-center gap-0.5 sm:gap-1">
          <LanguageSwitcher className="mr-1 hidden md:flex lg:mr-2" />
          <button
            type="button"
            className="grid size-10 place-items-center rounded-md text-sf-heading hover:bg-sf-canvas lg:hidden"
            aria-expanded={searchOpen}
            aria-controls="mobile-search"
            aria-label={searchOpen ? t('common.closeSearch') : t('common.openSearch')}
            onClick={() => setSearchOpen(!searchOpen)}
          >
            {searchOpen ? <XIcon aria-hidden className="size-6" /> : <SearchIcon aria-hidden className="size-6" />}
          </button>
          <HeaderActions />
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

/** The logo (with its renditions) or the store name in the heading font, linking home. */
function Brand({ className, logoClassName, nameClassName, sizes }: { className?: string; logoClassName: string; nameClassName: string; sizes: string }) {
  const { store, theme } = useStorefront()
  const { t } = useLocale()
  return (
    <Link to="/" className={cn('flex min-w-0 items-center', className)} aria-label={t('common.storeHome', { store: store.name })} data-testid="header-brand">
      {theme.logo ? (
        <MediaImage media={theme.logo} alt={store.name} sizes={sizes} loading="eager" className={logoClassName} />
      ) : (
        <span className={nameClassName}>{store.name}</span>
      )}
    </Link>
  )
}

/**
 * Centered brand (handmade): a search icon opening a search panel on the left, the brand in the
 * middle, account / wishlist / cart on the right, and an airy centred menu row below.
 */
function CenteredHeader() {
  const { menus } = useStorefront()
  const { sticky_header, top_bar } = useStoreLayout()
  return (
    <header className={cn('z-40 bg-sf-surface', sticky_header && 'sticky top-0')} data-testid="site-header" data-header-style="centered">
      <div className="mx-auto grid max-w-sf grid-cols-[1fr_auto_1fr] items-center gap-6 px-4 py-6">
        <div className="flex items-center gap-3">
          <SearchPanel />
          {top_bar !== 'utility' && <LanguageSwitcher />}
        </div>
        <Brand
          className="justify-center"
          sizes="260px"
          logoClassName="h-16 w-auto max-w-64 object-contain"
          nameClassName="truncate font-heading text-4xl font-semibold tracking-wide text-sf-heading"
        />
        <HeaderActions className="justify-self-end" />
      </div>
      <MainNav items={menus.main?.items ?? []} appearance="centered" />
    </header>
  )
}

/**
 * Commerce header (classic): logo left, a wide search field in the centre, account, wishlist and
 * the cart with its count and total on the right; a full-width menu bar below.
 */
function CommerceHeader() {
  const { menus } = useStorefront()
  const { sticky_header, top_bar } = useStoreLayout()
  return (
    <header className={cn('z-40 bg-sf-surface shadow-sm', sticky_header && 'sticky top-0')} data-testid="site-header" data-header-style="commerce">
      <div className="mx-auto flex max-w-sf items-center gap-8 px-4 py-5">
        <Brand
          className="shrink-0"
          sizes="220px"
          logoClassName="h-12 w-auto max-w-56 object-contain"
          nameClassName="truncate font-heading text-3xl font-extrabold tracking-tight text-sf-heading uppercase"
        />
        <HeaderSearch className="max-w-2xl flex-1 [&_input]:text-[0.95rem]" />
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {top_bar !== 'utility' && <LanguageSwitcher className="mr-2" />}
          <HeaderActions cartTotal />
        </div>
      </div>
      <MainNav items={menus.main?.items ?? []} appearance="commerce" />
    </header>
  )
}

/**
 * The header designed in the store builder (B4), shown alone. It keeps the theme's sticky setting;
 * its elements (logo, menu, search, account, wishlist, cart, …) are the store's own. B22a: below
 * 768 px it is drawn in its phone layout (../builder/phone-header.tsx).
 */
function BuilderHeader({ page, phone }: { page: BuilderPage; phone: boolean }) {
  const { sticky_header } = useStoreLayout()
  return (
    <header className={cn('z-40 bg-sf-surface', sticky_header && 'sticky top-0')} data-testid="site-header" data-header-style="builder" data-header-device={phone ? 'mobile' : undefined}>
      {phone ? <PhoneHeader page={page} scope="header" /> : <PageRenderer page={page} testId="builder-header" scope="header" />}
    </header>
  )
}
