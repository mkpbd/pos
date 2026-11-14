import { useEffect, useLayoutEffect } from 'react'
import { Outlet } from 'react-router'
import { ApiError } from '@/lib/api/client'
import { BootstrapContext } from '../api'
import { CartDrawerProvider } from '../cart/mini-cart'
import { QuickViewProvider } from '../catalog/quick-view'
import { LocaleContext, useLocale } from '../i18n/locale'
import { useLocaleController } from '../i18n/use-locale-controller'
import { PopupHost } from '../builder/popups/popup-host'
import { CampaignTracker } from '../landing/campaign-tracker'
import { PopupBanner } from '../popup/popup-banner'
import { WhatsAppChatButton } from '../social/whatsapp'
import { applyCssVars, applyDataAttributes, themeDataAttributes, themeToCssVars } from '../theme'
import type { StorefrontBootstrap } from '../types'
import { PreviewRibbon } from './announcement-bar'
import { NoticeProvider } from './notice-provider'
import { SiteFooter } from './site-footer'
import { SiteHeader } from './site-header'
import { StoreErrorView, StoreLoadingView, StoreNotFoundView } from './state-views'
import { TopBar } from './top-bar'

/**
 * Root of every storefront page: resolves the language and loads the bootstrap in it (inline
 * or fetched), applies the theme, and frames the page with announcement, header and footer.
 */
export function StorefrontLayout() {
  const { bootstrap: query, locale } = useLocaleController()

  if (query.data && locale) {
    return (
      <LocaleContext value={locale}>
        <BootstrapContext value={query.data}>
          <ThemeEffects bootstrap={query.data} />
          <CampaignTracker />
          <NoticeProvider>
            <CartDrawerProvider>
              <StoreFrame bootstrap={query.data} />
              <PopupBanner />
              <PopupHost />
              {/* P2b: the floating WhatsApp chat button, when the owner turned it on. */}
              <WhatsAppChatButton />
            </CartDrawerProvider>
          </NoticeProvider>
        </BootstrapContext>
      </LocaleContext>
    )
  }

  const view =
    query.error instanceof ApiError && query.error.code === 'STOREFRONT_NOT_FOUND' ? (
      <StoreNotFoundView />
    ) : query.error ? (
      <StoreErrorView onRetry={() => void query.refetch()} retrying={query.isFetching} />
    ) : (
      <StoreLoadingView />
    )
  return locale ? <LocaleContext value={locale}>{view}</LocaleContext> : view
}

function StoreFrame({ bootstrap }: { bootstrap: StorefrontBootstrap }) {
  const { t } = useLocale()
  return (
    <div className="sf-frame flex min-h-screen flex-col">
      <a href="#main" className="sr-only z-50 bg-sf-surface px-4 py-2 focus:not-sr-only focus:fixed focus:top-2 focus:left-2">
        {t('common.skipToContent')}
      </a>
      {bootstrap.preview && <PreviewRibbon />}
      <TopBar />
      <SiteHeader />
      <main id="main" tabIndex={-1} className="flex-1 focus:outline-none">
        <QuickViewProvider>
          <Outlet />
        </QuickViewProvider>
      </main>
      <SiteFooter />
    </div>
  )
}

/**
 * Document-level effects of the theme: CSS variables on :root (so portalled UI gets them
 * too), the tab title and favicon (Laravel writes them in production; Vite does not), and
 * the store's custom CSS — always as text content of a <style>, never as HTML.
 */
function ThemeEffects({ bootstrap }: { bootstrap: StorefrontBootstrap }) {
  const { theme, store } = bootstrap

  useLayoutEffect(() => applyCssVars(document.documentElement, themeToCssVars(theme)), [theme])
  useLayoutEffect(() => applyDataAttributes(document.documentElement, themeDataAttributes(theme)), [theme])

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
