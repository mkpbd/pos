import { useMemo } from 'react'
import { Link } from 'react-router'
import { useStorefront } from '../api'
import { storeContext } from '../builder/templates/context'
import type { StorePageRuntime } from '../builder/templates/runtime'
import { useTemplateEnabled } from '../builder/templates/enabled'
import { StoreTemplateView } from '../builder/templates/template-view'
import { useLocale } from '../i18n/locale'
import { useDocumentMeta } from '../use-document-meta'

/**
 * "Page not found". B14: drawn from the published "Page not found" template when there is one
 * (the meta stays noindex; crawlers get the 404 status from the server for unknown paths).
 */
export function NotFoundPage() {
  const { t } = useLocale()
  useDocumentMeta({ title: t('content.notFound.title'), noindex: true })
  const template = useTemplateEnabled('not_found')
  return template ? <NotFoundTemplate /> : <StandardNotFound />
}

function NotFoundTemplate() {
  const bootstrap = useStorefront()
  const { t } = useLocale()
  const runtime = useMemo<StorePageRuntime>(() => ({ context: { template: 'not_found', store: storeContext(bootstrap) } }), [bootstrap])
  return <StoreTemplateView template="not_found" runtime={runtime} fallback={<StandardNotFound />} heading={t('content.notFound.title')} />
}

function StandardNotFound() {
  const { t, digits } = useLocale()
  return (
    <section className="mx-auto max-w-sf px-4 py-20 text-center">
      <p className="font-heading text-7xl font-extrabold text-sf-accent">{digits('404')}</p>
      <h1 className="mt-2 text-3xl font-bold">{t('content.notFound.title')}</h1>
      <p className="mx-auto mt-3 max-w-md">{t('content.notFound.text')}</p>
      <Link
        to="/"
        className="mt-8 inline-flex items-center sf-button rounded-sf-button bg-sf-button px-6 py-3 text-sm font-bold tracking-wide text-sf-button-foreground uppercase transition-opacity hover:opacity-90"
      >
        {t('content.notFound.back')}
      </Link>
    </section>
  )
}
