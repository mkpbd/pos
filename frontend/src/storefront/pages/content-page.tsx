import { Link, useParams } from 'react-router'
import { Button } from '@/components/ui/button'
import { ApiError } from '@/lib/api/client'
import { useStorePageQuery } from '../api'
import { useDraftPreview } from '../builder/api'
import { FaqFallbackCtx } from '../builder/elements/faq-fallback'
import { hasHeadingLevel } from '../builder/payload'
import { PageRenderer } from '../builder/page-renderer'
import { withPageSeo } from '../builder/seo-meta'
import { ContactDetails, FaqGroups } from '../components/content-blocks'
import { ContactForm } from '../components/contact-form'
import { RichText } from '../components/rich-text'
import { useLocale } from '../i18n/locale'
import type { StorePage } from '../types'
import { useDocumentMeta } from '../use-document-meta'
import { NotFoundPage } from './not-found-page'

function PageTitle({ title }: { title: string }) {
  const { t } = useLocale()
  return (
    <div className="bg-sf-surface">
      <div className="mx-auto max-w-sf px-4 py-10 text-center">
        <h1 className="text-3xl font-extrabold lg:text-4xl">{title}</h1>
        <nav aria-label={t('content.page.breadcrumb')} className="mt-2 text-sm">
          <ol className="flex justify-center gap-2">
            <li><Link to="/" className="hover:underline">{t('content.page.home')}</Link></li>
            <li aria-hidden>/</li>
            <li aria-current="page">{title}</li>
          </ol>
        </nav>
      </div>
    </div>
  )
}

/**
 * A content page (/pages/:slug) in its layout: standard, FAQ or contact. B4: a page designed in the
 * store builder (`builder` payload) shows that design instead of the CMS body; the page title
 * band stays unless the design has its own level-1 heading. SEO and meta are the CMS page's.
 */
export function ContentPage() {
  const { slug = '' } = useParams()
  const draft = useDraftPreview()
  const page = useStorePageQuery(slug, draft)
  const { t } = useLocale()
  // B9: a page designed in the builder lays its own SEO (published; a draft preview: the draft's) over the CMS page's.
  useDocumentMeta(
    page.data
      ? withPageSeo({ title: page.data.seo_title ?? page.data.title, description: page.data.seo_description, canonical: `/pages/${page.data.slug}` }, page.data.builder)
      : null,
  )

  if (page.isPending) {
    return (
      <div role="status" className="grid min-h-[50vh] place-items-center">
        <span className="size-10 animate-spin rounded-full border-4 border-sf-border border-t-sf-accent" aria-hidden />
        <span className="sr-only">{t('content.loading')}</span>
      </div>
    )
  }
  if (page.error instanceof ApiError && page.error.status === 404) return <NotFoundPage />
  if (page.error) {
    return (
      <section className="mx-auto max-w-sf px-4 py-16 text-center">
        <h1 className="text-2xl font-bold">{t('content.loadError')}</h1>
        <Button className="mt-4 h-11 rounded-sf-button px-6" onClick={() => void page.refetch()}>{t('common.tryAgain')}</Button>
      </section>
    )
  }

  const data = page.data
  if (data.builder && Array.isArray(data.builder.sections)) return <BuilderContentPage page={data} />
  return (
    <article>
      <PageTitle title={data.title} />
      <div className="mx-auto max-w-sf px-4 py-12">
        {data.template === 'contact' ? (
          <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
            <div className="flex flex-col gap-6">
              {data.body_html && <RichText html={data.body_html} />}
              <ContactDetails />
            </div>
            <ContactForm />
          </div>
        ) : (
          <div className="mx-auto max-w-3xl">
            {data.body_html && <RichText html={data.body_html} />}
            {data.template === 'faq' && <FaqGroups groups={data.faq ?? []} className="mt-10" />}
          </div>
        )}
      </div>
    </article>
  )
}

function BuilderContentPage({ page }: { page: StorePage }) {
  const { t } = useLocale()
  const builder = page.builder!
  return (
    <article data-testid="content-page" data-builder="true">
      {builder.document?.source === 'draft' && (
        <p role="status" className="bg-neutral-900 px-4 py-1.5 text-center text-xs font-semibold text-white">
          {t('content.builder.preview')}
        </p>
      )}
      {!hasHeadingLevel(builder.sections, 1) && <PageTitle title={page.title} />}
      <FaqFallbackCtx value={page.faq ?? null}>
        <PageRenderer page={builder} scope="page" />
      </FaqFallbackCtx>
    </article>
  )
}
