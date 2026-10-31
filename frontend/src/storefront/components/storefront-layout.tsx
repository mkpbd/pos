import { useEffect, useLayoutEffect } from 'react'
import { Outlet } from 'react-router'
import { ApiError } from '@/lib/api/client'
import { BootstrapContext, useBootstrapQuery } from '../api'
import { CartDrawerProvider } from '../cart/mini-cart'
import { QuickViewProvider } from '../catalog/quick-view'
import { applyCssVars, themeToCssVars } from '../theme'
import type { StorefrontBootstrap } from '../types'
import { AnnouncementBar, PreviewRibbon } from './announcement-bar'
import { NoticeProvider } from './notice-provider'
import { SiteFooter } from './site-footer'
import { SiteHeader } from './site-header'
import { StoreErrorView, StoreLoadingView, StoreNotFoundView } from './state-views'

/**
 * Root of every storefront page: loads the bootstrap (inline or fetched), applies the
 * theme, and frames the page with announcement, header and footer.
 */
export function StorefrontLayout() {
  const query = useBootstrapQuery()

  if (query.data) {
    return (
      <BootstrapContext value={query.data}>
        <ThemeEffects bootstrap={query.data} />
        <NoticeProvider>
          <CartDrawerProvider>
            <div className="flex min-h-screen flex-col">
              <a href="#main" className="sr-only z-50 bg-sf-surface px-4 py-2 focus:not-sr-only focus:fixed focus:top-2 focus:left-2">
                Skip to content
              </a>
              {query.data.preview && <PreviewRibbon />}
              {query.data.theme.announcement && <AnnouncementBar announcement={query.data.theme.announcement} />}
              <SiteHeader />
              <main id="main" tabIndex={-1} className="flex-1 focus:outline-none">
                <QuickViewProvider>
                  <Outlet />
                </QuickViewProvider>
              </main>
              <SiteFooter />
            </div>
          </CartDrawerProvider>
        </NoticeProvider>
      </BootstrapContext>
    )
  }

  if (query.error instanceof ApiError && query.error.code === 'STOREFRONT_NOT_FOUND') return <StoreNotFoundView />
  if (query.error) return <StoreErrorView onRetry={() => void query.refetch()} retrying={query.isFetching} />
  return <StoreLoadingView />
}

/**
 * Document-level effects of the theme: CSS variables on :root (so portalled UI gets them
 * too), the tab title and favicon (Laravel writes them in production; Vite does not), and
 * the store's custom CSS — always as text content of a <style>, never as HTML.
 */
function ThemeEffects({ bootstrap }: { bootstrap: StorefrontBootstrap }) {
  const { theme, store } = bootstrap

  useLayoutEffect(() => applyCssVars(document.documentElement, themeToCssVars(theme)), [theme])

  useEffect(() => {
    if (!document.title || document.title === 'Storefront') document.title = store.name
  }, [store.name])

  useEffect(() => {
    if (!theme.favicon) return
    let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
    if (!link) {
      link = document.createElement('link')
      link.rel = 'icon'
      document.head.appendChild(link)
    }
    link.removeAttribute('type')
    link.href = theme.favicon.url
  }, [theme.favicon])

  return theme.custom_css ? <style data-testid="custom-css">{theme.custom_css}</style> : null
}
