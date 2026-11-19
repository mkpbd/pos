import type { ReactNode } from 'react'
import { useStorefront } from '../../api'
import { useLocale } from '../../i18n/locale'
import { useDraftPreview, useTemplateQuery } from '../api'
import { PageRenderer } from '../page-renderer'
import { templateHasH1 } from './enabled'
import { StorePageCtx, type StorePageRuntime } from './runtime'
import type { StoreTemplateKey } from './types'

/*
 * B14: a store page (shop, category, brand, search, blog post, order, 404) drawn from its
 * published store builder template. The route keeps everything that is not design: the data it
 * loads, the document meta (title, description, canonical, noindex), the 404 status and its
 * loading / error states. Without a published template (or when it can't be loaded) the standard
 * page shows, exactly as before.
 */

function Loading() {
  const { t } = useLocale()
  return (
    <div role="status" className="grid min-h-[50vh] place-items-center" data-testid="template-loading">
      <span className="size-10 animate-spin rounded-full border-4 border-sf-border border-t-sf-accent motion-reduce:animate-none" aria-hidden />
      <span className="sr-only">{t('content.loading')}</span>
    </div>
  )
}

/**
 * The template with the route's runtime. `fallback`: the standard page (not published, or the
 * template could not be loaded — the store keeps working). `heading`: the page's title for screen
 * readers when the design has no h1 of its own.
 */
export function StoreTemplateView({ template, runtime, fallback, heading }: { template: StoreTemplateKey; runtime: StorePageRuntime; fallback: ReactNode; heading?: string | null }) {
  const page = useTemplateQuery(template)
  const draft = useDraftPreview()
  const { preview } = useStorefront()
  const { t } = useLocale()

  if (page.isPending) return <Loading />
  if (page.error || !page.data) return <>{fallback}</>

  const isDraft = page.data.document?.source === 'draft'
  return (
    <div data-testid="store-template" data-template={template}>
      {isDraft && (
        <p role="status" className="bg-neutral-900 px-4 py-1.5 text-center text-xs font-semibold text-white">
          {t('content.builder.preview')}
        </p>
      )}
      {heading && !templateHasH1(page.data.sections) && <h1 className="sr-only">{heading}</h1>}
      <StorePageCtx value={runtime}>
        {/* B15: template pages count for Insights like pages (their own document id / version). */}
        <PageRenderer page={page.data} scope="page" insights={!draft && !preview && !isDraft} />
      </StorePageCtx>
    </div>
  )
}
