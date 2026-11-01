import { useSearchParams } from 'react-router'
import { Button } from '@/components/ui/button'
import { useHomepageQuery, useStorefront } from '../api'
import { SectionList } from '../sections/section-renderer'
import { useDocumentMeta } from '../use-document-meta'

/**
 * The store's front page: the homepage sections configured in the admin, in order.
 * `?preview=1` shows staff the hidden and scheduled sections in place.
 */
export function HomePage() {
  const { store } = useStorefront()
  const [params] = useSearchParams()
  const previewParam = params.get('preview') === '1'
  const homepage = useHomepageQuery(previewParam)
  useDocumentMeta({ canonical: '/', noindex: previewParam })

  if (homepage.isPending) {
    return (
      <div role="status" className="grid min-h-[50vh] place-items-center">
        <span className="size-10 animate-spin rounded-full border-4 border-sf-border border-t-sf-accent" aria-hidden />
        <span className="sr-only">Loading</span>
      </div>
    )
  }

  if (homepage.error) {
    return (
      <section className="mx-auto max-w-sf px-4 py-16 text-center">
        <h1 className="text-2xl font-bold">This page could not be loaded</h1>
        <Button className="mt-4 rounded-sf-button" onClick={() => void homepage.refetch()}>Try again</Button>
      </section>
    )
  }

  const { sections, preview } = homepage.data

  return (
    <>
      <h1 className="sr-only">{store.name}</h1>
      {preview && (
        <p role="status" className="bg-neutral-900 px-4 py-1.5 text-center text-xs font-semibold text-white">
          Homepage preview — sections visitors do not see are marked.
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
