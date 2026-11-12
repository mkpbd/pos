import { useEffect, useId, type ReactNode } from 'react'
import { LayoutDashboardIcon, StoreIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { LanguageSwitcher } from '../components/language-switcher'
import { PageLoadingView } from '../components/state-views'
import { LocaleContext, useLocale } from '../i18n/locale'
import { rich } from '../i18n/rich'
import { isMessageKey } from '../i18n/translate'
import { headingFontStack } from '../theme'
import { isGalleryDisabled, useDemoStoresQuery, type DemoStore } from './api'
import { useStandaloneLocale } from './demo-locale'
import { demoAdminUrl, demoStoreUrl, safeColor } from './links'

const SEED_COMMAND = 'php artisan db:seed --class=DemoThemesSeeder'
const ADMIN_HINT_ID = 'demo-admin-hint'

/**
 * The demo store gallery (/demos, T2): a page of its own, outside the store layout, so it works
 * on any host, with or without a store. Lists the demos the server offers and links to each
 * store and to the admin. Never shows logins.
 */
export function DemoGalleryPage() {
  const locale = useStandaloneLocale()
  if (!locale) return <PageLoadingView />
  return (
    <LocaleContext value={locale}>
      <DemoGallery />
    </LocaleContext>
  )
}

function DemoGallery() {
  const { t } = useLocale()
  const title = t('demos.title')

  useEffect(() => {
    document.title = title
  }, [title])

  useEffect(() => {
    const robots = document.createElement('meta')
    robots.name = 'robots'
    robots.content = 'noindex, follow'
    document.head.appendChild(robots)
    return () => robots.remove()
  }, [])

  return (
    <div className="min-h-screen bg-sf-canvas">
      <main className="mx-auto w-full max-w-6xl px-4 py-10 sm:py-14">
        <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="max-w-2xl space-y-3">
            <h1 className="text-3xl font-bold sm:text-4xl">{title}</h1>
            <p className="text-base">{t('demos.intro')}</p>
            <p id={ADMIN_HINT_ID} className="text-sm opacity-80">
              {t('demos.adminHint')}
            </p>
          </div>
          <LanguageSwitcher className="shrink-0" />
        </header>
        <GalleryBody />
      </main>
    </div>
  )
}

function GalleryBody() {
  const { t } = useLocale()
  const query = useDemoStoresQuery()

  if (query.isPending) return <GallerySkeleton />

  if (query.isError) {
    if (isGalleryDisabled(query.error)) return <Notice testId="demo-disabled">{t('demos.disabled')}</Notice>
    return (
      <div role="alert" className="max-w-xl space-y-3 rounded-sf-card border bg-sf-surface p-6" data-testid="demo-error">
        <h2 className="text-xl font-bold">{t('demos.errorTitle')}</h2>
        <p>{t('demos.errorText')}</p>
        <Button onClick={() => void query.refetch()} disabled={query.isFetching} className="rounded-sf-button">
          {query.isFetching ? t('common.retrying') : t('common.tryAgain')}
        </Button>
      </div>
    )
  }

  if (query.data.length === 0) {
    return (
      <Notice testId="demo-empty">
        {rich(t('demos.empty'), { command: <code className="rounded bg-sf-canvas px-1.5 py-0.5 font-mono text-sm text-sf-heading">{SEED_COMMAND}</code> })}
      </Notice>
    )
  }

  return (
    <ul aria-label={t('demos.list')} className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-4" data-testid="demo-grid">
      {query.data.map((demo) => (
        <li key={demo.host} className="flex">
          <DemoCard demo={demo} />
        </li>
      ))}
    </ul>
  )
}

function Notice({ children, testId }: { children: ReactNode; testId: string }) {
  return (
    <p role="status" className="max-w-xl rounded-sf-card border bg-sf-surface p-6 text-base" data-testid={testId}>
      {children}
    </p>
  )
}

function GallerySkeleton() {
  const { t } = useLocale()
  return (
    <div role="status" aria-live="polite" data-testid="demo-loading">
      <span className="sr-only">{t('demos.loading')}</span>
      <div aria-hidden className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2].map((index) => (
          <div key={index} className="overflow-hidden rounded-sf-card border bg-sf-surface">
            <Skeleton className="aspect-video rounded-none" />
            <div className="space-y-3 p-5">
              <Skeleton className="h-6 w-2/3" />
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-9 w-full" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function presetLabel(preset: string, t: ReturnType<typeof useLocale>['t']): string {
  const key = `demos.preset.${preset}`
  return isMessageKey(key) ? t(key) : preset
}

function DemoCard({ demo }: { demo: DemoStore }) {
  const { t } = useLocale()
  const headingId = useId()
  const primary = safeColor(demo.colors?.primary)
  const accent = safeColor(demo.colors?.accent)
  const canvas = safeColor(demo.colors?.canvas)
  const storeUrl = demoStoreUrl(demo.host)
  const swatches = [
    { key: 'primary', value: primary, label: t('demos.color.primary', { value: primary ?? '' }) },
    { key: 'accent', value: accent, label: t('demos.color.accent', { value: accent ?? '' }) },
    { key: 'canvas', value: canvas, label: t('demos.color.canvas', { value: canvas ?? '' }) },
  ].filter((swatch) => swatch.value !== null)
  const categories = (demo.category_names ?? []).slice(0, 6)

  return (
    <article
      aria-labelledby={headingId}
      className="flex w-full flex-col overflow-hidden rounded-sf-card border bg-sf-surface shadow-sm"
      data-testid="demo-card"
      data-preset={demo.preset}
    >
      {demo.image_url ? (
        <img src={demo.image_url} alt="" loading="lazy" className="aspect-video w-full object-cover" data-testid="demo-image" />
      ) : (
        <div
          aria-hidden
          className="aspect-video w-full"
          style={{ background: `linear-gradient(135deg, ${primary ?? '#d1d5db'} 0%, ${accent ?? '#6b7280'} 100%)`, backgroundColor: canvas ?? undefined }}
          data-testid="demo-color-block"
        />
      )}
      <div className="flex flex-1 flex-col gap-3 p-5">
        <div className="space-y-1">
          <h2 id={headingId} className="text-2xl font-bold" style={{ fontFamily: headingFontStack(demo.heading_font) }}>
            {demo.name}
          </h2>
          <p className="text-xs font-semibold tracking-wide uppercase opacity-80">{t('demos.preset', { preset: presetLabel(demo.preset, t) })}</p>
        </div>
        {demo.tagline && <p className="text-sm">{demo.tagline}</p>}
        {swatches.length > 0 && (
          <ul aria-label={t('demos.colors')} className="flex items-center gap-2">
            {swatches.map((swatch) => (
              <li key={swatch.key} className="flex" title={swatch.label}>
                <span aria-hidden className="size-6 rounded-full border border-black/10" style={{ backgroundColor: swatch.value ?? undefined }} data-testid={`swatch-${swatch.key}`} />
                <span className="sr-only">{swatch.label}</span>
              </li>
            ))}
          </ul>
        )}
        {categories.length > 0 && (
          <ul aria-label={t('demos.categories')} className="flex flex-wrap gap-1.5">
            {categories.map((name) => (
              <li key={name} className="rounded-full border bg-sf-canvas px-2.5 py-0.5 text-xs text-sf-heading">
                {name}
              </li>
            ))}
          </ul>
        )}
        <p className="text-sm font-medium text-sf-heading">{t('demos.products', { count: demo.product_count })}</p>
        <div className="mt-auto flex flex-wrap gap-2 pt-2">
          {storeUrl && (
            <Button asChild className="rounded-sf-button">
              <a href={storeUrl} aria-label={t('demos.openStoreLabel', { store: demo.name })}>
                <StoreIcon aria-hidden />
                {t('demos.openStore')}
              </a>
            </Button>
          )}
          <Button asChild variant="outline" className="rounded-sf-button">
            <a href={demoAdminUrl()} aria-label={t('demos.openAdminLabel', { store: demo.name })} aria-describedby={ADMIN_HINT_ID}>
              <LayoutDashboardIcon aria-hidden />
              {t('demos.openAdmin')}
            </a>
          </Button>
        </div>
      </div>
    </article>
  )
}
