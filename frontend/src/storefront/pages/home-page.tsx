import { useSearchParams } from 'react-router'
import { Button } from '@/components/ui/button'
import { useHomepageQuery, useStorefront } from '../api'
import { useLocale } from '../i18n/locale'
import { SectionList } from '../sections/section-renderer'
import { useDocumentMeta } from '../use-document-meta'

/**
 * The store's front page: the homepage sections configured in the admin, in order.
 * `?preview=1` shows staff the hidden and scheduled sections in place.
 */
export function HomePage() {
  const { store } = useStorefront()
  const { t } = useLocale()
  const [params] = useSearchParams()
  const previewParam = params.get('preview') === '1'
  const homepage = useHomepageQuery(previewParam)
  useDocumentMeta({ canonical: '/', noindex: previewParam })

  if (homepage.isPending) {
    return (
      <div role="status" className="grid min-h-[50vh] place-items-center">
        <span className="size-10 animate-spin rounded-full border-4 border-sf-border border-t-sf-accent" aria-hidden />
        <span className="sr-only">{t('content.loading')}</span>
      </div>
    )
  }

  if (homepage.error) {
    return (
      <section className="mx-auto max-w-sf px-4 py-16 text-center">
        <h1 className="text-2xl font-bold">{t('content.loadError')}</h1>
        <p className="mt-2">{t('common.store.errorText')}</p>
        <Button className="mt-4 h-11 rounded-sf-button px-6" onClick={() => void homepage.refetch()}>{t('common.tryAgain')}</Button>
      </section>
    )
  }

  const { sections, preview } = homepage.data

  return (
    <>
      <h1 className="sr-only">{store.name}</h1>
      {preview && (
        <p role="status" className="bg-neutral-900 px-4 py-1.5 text-center text-xs font-semibold text-white">
          {t('content.home.preview')}
        </p>
      )}
      {sections.length > 0 ? (
        <SectionList sections={sections} />
      ) : (
        <section className="mx-auto max-w-sf px-4 py-16 text-center lg:py-24">
          <p className="text-4xl font-extrabold text-sf-heading lg:text-5xl">{store.name}</p>
          {store.description && <p className="mx-auto mt-4 max-w-2xl text-lg">{store.description}</p>}
        </section>
      )}
    </>
  )
}
