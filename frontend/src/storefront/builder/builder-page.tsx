import type { ReactNode } from 'react'
import { Navigate, useLocation, useParams } from 'react-router'
import { Button } from '@/components/ui/button'
import { ApiError } from '@/lib/api/client'
import { useStorefront } from '../api'
import { useLocale } from '../i18n/locale'
import { NotFoundPage } from '../pages/not-found-page'
import { useDocumentMeta, type DocumentMeta } from '../use-document-meta'
import { useDraftPreview, usePageQuery } from './api'
import { PageRenderer } from './page-renderer'
import type { BuilderPage } from './types'

type Props = {
  /** `home` or a landing page's slug. */
  pageKey: string
  /** Shown when the page does not exist (404). */
  notFound: ReactNode
  meta: (page: BuilderPage, draft: boolean) => DocumentMeta
  /** Above the page (the front page's screen-reader title). */
  children?: ReactNode
}

/** A builder page with the storefront's loading and error states. */
export function BuilderPageView({ pageKey, notFound, meta, children }: Props) {
  const page = usePageQuery(pageKey)
  const draft = useDraftPreview()
  const { t } = useLocale()
  useDocumentMeta(page.data ? meta(page.data, draft) : null)

  if (page.isPending) {
    return (
      <div role="status" className="grid min-h-[50vh] place-items-center">
        <span className="size-10 animate-spin rounded-full border-4 border-sf-border border-t-sf-accent" aria-hidden />
        <span className="sr-only">{t('content.loading')}</span>
      </div>
    )
  }

  if (page.error instanceof ApiError && page.error.status === 404) return <>{notFound}</>

  if (page.error) {
    return (
      <section className="mx-auto max-w-sf px-4 py-16 text-center">
        <h1 className="text-2xl font-bold">{t('content.loadError')}</h1>
        <p className="mt-2">{t('common.store.errorText')}</p>
        <Button className="mt-4 h-11 rounded-sf-button px-6" onClick={() => void page.refetch()}>{t('common.tryAgain')}</Button>
      </section>
    )
  }

  return (
    <>
      {children}
      {page.data.document?.source === 'draft' && (
        <p role="status" className="bg-neutral-900 px-4 py-1.5 text-center text-xs font-semibold text-white">
          {t('content.builder.preview')}
        </p>
      )}
      <PageRenderer page={page.data} scope="page" />
    </>
  )
}

/** The front page built in the store builder; without one (404) the homepage sections. */
export function BuilderHomePage({ fallback }: { fallback: ReactNode }) {
  const { store } = useStorefront()
  return (
    <BuilderPageView pageKey="home" notFound={fallback} meta={(_, draft) => ({ canonical: '/', noindex: draft })}>
      <h1 className="sr-only">{store.name}</h1>
    </BuilderPageView>
  )
}

const LANDING_SLUG = /^[a-z0-9-]{2,60}$/

/** A landing page (/p/:slug) built in the store builder. */
export function LandingPage() {
  const { slug = '' } = useParams()
  const { search } = useLocation()
  // "home" is the front page's key, not a landing slug.
  if (slug === 'home') return <Navigate to={{ pathname: '/', search }} replace />
  if (!LANDING_SLUG.test(slug)) return <NotFoundPage />
  return (
    <BuilderPageView
      key={slug}
      pageKey={slug}
      notFound={<NotFoundPage />}
      meta={(page, draft) => ({ title: page.document?.title || undefined, canonical: `/p/${slug}`, noindex: draft })}
    />
  )
}
