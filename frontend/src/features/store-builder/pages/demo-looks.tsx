import { useState } from 'react'
import { Link } from 'react-router'
import { CircleCheckIcon, ExternalLinkIcon, EyeIcon, Loader2Icon, PaletteIcon, PencilIcon, SendIcon, SparklesIcon, StarIcon } from 'lucide-react'
import { toast } from 'sonner'
import { ErrorState, LoadingState } from '@/components/common/state-views'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useThemeDraftQuery, useThemePresetsQuery } from '@/features/storefront/api'
import { cn } from '@/lib/utils'
import { demoStoreUrl } from '@/storefront/demos/links'
import type { DocumentSummary } from '../api'
import { isSitePreset, useLiveDemosQuery, usePublishAllMutation, useSiteTemplatesQuery, type BuilderTemplate } from '../templates/api'
import { TemplateThumbnail } from '../templates/template-thumbnail'
import { PreviewDialog, Swatches, UseLookDialog, type UseOutcome, type UseRequest } from './look-dialogs'
import { liveUrl, LOOKS_ANCHOR } from './page-helpers'
import { useScreenText } from './screen-language'
import { ScreenConfirm } from './screen-ui'

/*
 * "Choose a look" on the pages list (B5, B7): the shop looks (site templates) in the API's order,
 * the first one featured. Each look: Preview (a dialog with its whole home page), See live demo
 * (its demo store, when this server lists one) and Use this look (drafts → review → publish all,
 * or use and publish now). The live store changes only on publish.
 */

/** Grid columns for the looks after the featured one, so no row ends with a lone card. */
function gridColumns(count: number): string {
  if (count >= 4 && count % 4 === 0) return 'sm:grid-cols-2 xl:grid-cols-4'
  if (count % 3 === 0) return 'md:grid-cols-3'
  if (count % 2 === 0) return 'sm:grid-cols-2'
  return count === 1 ? '' : 'sm:grid-cols-2 xl:grid-cols-3'
}

/** The store's URL from a draft preview link (`https://shop.test/?preview=draft` → `https://shop.test/`). */
function storeRoot(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    return `${new URL(url).origin}/`
  } catch {
    return null
  }
}

/* ---------------------------------------------------------------------------------------------- */

type Review = UseOutcome

function ReviewPanel({ review, canPublish, onPublished, onClose }: { review: Review; canPublish: boolean; onPublished: () => void; onClose: () => void }) {
  const { t, tc } = useScreenText()
  const publishAll = usePublishAllMutation()
  const [confirming, setConfirming] = useState(false)
  const { documents } = review.result
  const home = documents.find((d) => d.kind === 'page' && d.key === 'home')
  const themePreview = review.result.theme?.preview_url ?? home?.preview_url ?? documents.find((d) => d.preview_url)?.preview_url ?? null
  const count = documents.length + (review.include.theme ? 1 : 0)
  const storeUrl = (home ? liveUrl(home) : null) ?? storeRoot(themePreview)
  const failure = publishAll.error ? (publishAll.error instanceof Error ? publishAll.error.message : t('review.failed')) : review.error ? t('review.publishFailed', { message: review.error }) : null

  const publish = () =>
    publishAll.mutate(
      { documents: documents.map((d) => d.id), theme: review.include.theme, note: `${review.look.name} demo look` },
      {
        onSuccess: () => {
          toast.success(t('use.live', { name: review.look.name }))
          onPublished()
        },
      },
    )

  const name = review.look.name
  return (
    <Card data-testid="demo-review" role="region" aria-labelledby="demo-review-title" id={LOOKS_ANCHOR}>
      <CardHeader>
        <CardTitle id="demo-review-title" role="heading" aria-level={2} aria-live="polite" className="flex items-center gap-2">
          {review.published ? <CircleCheckIcon className="size-5 text-emerald-600" aria-hidden /> : <SparklesIcon className="size-5" aria-hidden />}
          {review.published ? t('review.liveTitle', { name }) : t('review.title', { name })}
        </CardTitle>
        <CardDescription>{review.published ? t('review.liveText') : t('review.text')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <ul className="divide-y" aria-label={t('review.listLabel')}>
          {review.include.theme && (
            <li className="flex flex-wrap items-center gap-3 py-3" data-testid="demo-review-theme">
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 font-medium">
                  <PaletteIcon className="size-4 text-muted-foreground" aria-hidden /> {t('review.theme')}
                </p>
                <p className="text-sm text-muted-foreground">{t('review.themeDetail')}</p>
              </div>
              <Badge variant={review.published ? 'success' : 'soft'}>{review.published ? t('review.published') : t('review.draft')}</Badge>
              <div className="flex flex-wrap items-center gap-1">
                <Button variant="outline" size="sm" asChild>
                  <Link to="/storefront/theme" aria-label={t('review.editTheme')}>
                    <PencilIcon aria-hidden /> {t('common.edit')}
                  </Link>
                </Button>
                {themePreview && !review.published && (
                  <Button variant="ghost" size="sm" asChild>
                    <a href={themePreview} target="_blank" rel="noopener noreferrer" aria-label={t('review.previewTheme')}>
                      <ExternalLinkIcon aria-hidden /> {t('common.preview')}
                    </a>
                  </Button>
                )}
              </div>
            </li>
          )}
          {documents.map((doc) => (
            <li key={doc.id} className="flex flex-wrap items-center gap-3 py-3" data-testid={`demo-review-${doc.key}`}>
              <div className="min-w-0 flex-1">
                <p className="font-medium">{doc.title}</p>
                <p className="text-sm text-muted-foreground">{t(doc.kind === 'header' || doc.kind === 'footer' || doc.kind === 'zone' ? (`review.kind.${doc.kind}` as const) : 'review.kind.page')}</p>
              </div>
              <Badge variant={review.published ? 'success' : 'soft'}>{review.published ? t('review.published') : t('review.draft')}</Badge>
              <div className="flex flex-wrap items-center gap-1">
                <Button variant="outline" size="sm" asChild>
                  <Link to={`/storefront/builder/${doc.id}`} aria-label={t('review.editDoc', { name: doc.title })}>
                    <PencilIcon aria-hidden /> {t('common.edit')}
                  </Link>
                </Button>
                {doc.preview_url && !review.published && (
                  <Button variant="ghost" size="sm" asChild>
                    <a href={doc.preview_url} target="_blank" rel="noopener noreferrer" aria-label={t('review.previewDoc', { name: doc.title })}>
                      <ExternalLinkIcon aria-hidden /> {t('common.preview')}
                    </a>
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
        {failure && !review.published && (
          <p role="alert" className="text-sm text-destructive">
            {failure}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-3">
          {review.published ? (
            <>
              {storeUrl && (
                <Button asChild>
                  <a href={storeUrl} target="_blank" rel="noopener noreferrer">
                    <ExternalLinkIcon aria-hidden /> {t('review.viewStore')}
                  </a>
                </Button>
              )}
              <Button variant="ghost" onClick={onClose}>
                {t('common.close')}
              </Button>
            </>
          ) : (
            <>
              <Button disabled={!canPublish || publishAll.isPending || count === 0} onClick={() => setConfirming(true)}>
                {publishAll.isPending ? <Loader2Icon className="animate-spin" aria-hidden /> : <SendIcon aria-hidden />}
                {t('review.publishAll')}
              </Button>
              <Button variant="ghost" onClick={onClose}>
                {t('review.later')}
              </Button>
              {!canPublish && <p className="text-sm text-muted-foreground">{t('review.noPermission')}</p>}
            </>
          )}
        </div>
      </CardContent>
      <ScreenConfirm
        open={confirming}
        onOpenChange={setConfirming}
        title={t('review.confirmTitle')}
        description={tc('review.confirmText', count)}
        confirmLabel={t('review.publishAll')}
        destructive={false}
        onConfirm={() => {
          setConfirming(false)
          publish()
        }}
      />
    </Card>
  )
}

/* ---------------------------------------------------------------------------------------------- */

function LookCard({
  look,
  featured,
  colors,
  demoUrl,
  onPreview,
  onUse,
}: {
  look: BuilderTemplate
  featured: boolean
  colors: string[]
  demoUrl: string | null
  onPreview: () => void
  onUse: () => void
}) {
  const { t } = useScreenText()
  return (
    <li
      className={cn('flex flex-col gap-3 rounded-lg border bg-background p-3', featured && 'col-span-full gap-4 border-primary/40 bg-primary/[0.03] p-4 md:grid md:grid-cols-2 md:items-center md:gap-6')}
      data-testid={`demo-look-${look.preset}`}
      data-featured={featured || undefined}
    >
      {/* The picture opens the preview too (the Preview button is the keyboard way in). */}
      <button type="button" tabIndex={-1} aria-hidden className="block cursor-zoom-in rounded-md focus:outline-none" onClick={onPreview}>
        <TemplateThumbnail template={look} className={featured ? 'shadow-sm' : undefined} />
      </button>
      <div className="flex flex-1 flex-col gap-3">
        <div className="flex flex-1 flex-col gap-1.5">
          {featured && (
            <Badge variant="soft" className="h-auto gap-1 py-1 whitespace-normal" data-testid="demo-featured-badge">
              <StarIcon aria-hidden /> {look.preset === 'kids' ? t('looks.recommendedKids') : t('looks.recommended')}
            </Badge>
          )}
          <p className={cn('flex flex-wrap items-center justify-between gap-x-2 gap-y-1 font-medium', featured && 'text-xl font-semibold')}>
            {look.name}
            <Swatches colors={colors} label={t('looks.colours')} size={featured ? 'md' : 'sm'} />
          </p>
          {look.description && <p className={cn('text-sm text-muted-foreground', featured && 'text-base')}>{look.description}</p>}
        </div>
        <div className={cn('flex flex-wrap gap-2', !featured && 'flex-col')}>
          <Button size={featured ? 'default' : 'sm'} aria-label={t('looks.useAria', { name: look.name })} onClick={onUse}>
            {t('looks.use')}
          </Button>
          <Button variant="outline" size={featured ? 'default' : 'sm'} aria-label={t('looks.previewAria', { name: look.name })} onClick={onPreview}>
            <EyeIcon aria-hidden /> {t('looks.preview')}
          </Button>
          {demoUrl && (
            <Button variant="ghost" size={featured ? 'default' : 'sm'} asChild>
              <a href={demoUrl} target="_blank" rel="noopener noreferrer" aria-label={t('looks.liveDemoAria', { name: look.name })}>
                <ExternalLinkIcon aria-hidden /> {t('looks.liveDemo')}
              </a>
            </Button>
          )}
        </div>
      </div>
    </li>
  )
}

/** The "Choose a look" card (people who manage the store), or the review of the drafts it made. */
export function DemoLooksCard({ documents, canManage, canPublish }: { documents: DocumentSummary[]; canManage: boolean; canPublish: boolean }) {
  const { t, tc } = useScreenText()
  const looks = useSiteTemplatesQuery(canManage)
  const presets = useThemePresetsQuery()
  const themeDraft = useThemeDraftQuery()
  const demos = useLiveDemosQuery(canManage)
  const [previewing, setPreviewing] = useState<BuilderTemplate | null>(null)
  const [using, setUsing] = useState<UseRequest | null>(null)
  const [review, setReview] = useState<Review | null>(null)

  if (!canManage) return null
  if (review) {
    return <ReviewPanel review={review} canPublish={canPublish} onPublished={() => setReview({ ...review, published: true, error: undefined })} onClose={() => setReview(null)} />
  }

  const sites = (looks.data ?? []).filter((t) => t.scope === 'site' && isSitePreset(t.preset))
  if (looks.isSuccess && sites.length === 0) return null
  const colorsOf = (preset: string | null) => {
    const colors = presets.data?.find((p) => p.key === preset)?.theme.colors as Record<string, string | null | undefined> | undefined
    if (!colors) return []
    return ['primary', 'accent', 'highlight', 'heading', 'canvas'].map((key) => colors[key]).filter((hex): hex is string => typeof hex === 'string')
  }
  // The original look has no demo store; the others link to theirs when this server lists it.
  const demoUrlOf = (look: BuilderTemplate) => {
    if (!look.preset || look.preset === 'default') return null
    const demo = demos.data?.find((d) => d.preset === look.preset)
    return demo ? demoStoreUrl(demo.host) : null
  }
  const rest = Math.max(0, sites.length - 1)

  return (
    <Card data-testid="demo-looks" id={LOOKS_ANCHOR} className="scroll-mt-4">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SparklesIcon className="size-5" aria-hidden /> {t('looks.title')}
        </CardTitle>
        <CardDescription>{t('looks.text')}</CardDescription>
      </CardHeader>
      <CardContent>
        {looks.isPending ? (
          <LoadingState rows={2} label={t('looks.loading')} />
        ) : looks.error ? (
          <ErrorState title={t('looks.error')} error={looks.error} onRetry={() => void looks.refetch()} />
        ) : (
          <ul className={cn('grid gap-4', gridColumns(rest))} aria-label={t('looks.listLabel')}>
            {sites.map((look, index) => (
              <LookCard
                key={look.id}
                look={look}
                featured={index === 0}
                colors={colorsOf(look.preset)}
                demoUrl={demoUrlOf(look)}
                onPreview={() => setPreviewing(look)}
                onUse={() => setUsing({ look, publishNow: false })}
              />
            ))}
          </ul>
        )}
      </CardContent>
      <PreviewDialog
        look={previewing}
        colors={previewing ? colorsOf(previewing.preset) : []}
        demoUrl={previewing ? demoUrlOf(previewing) : null}
        canPublish={canPublish}
        onClose={() => setPreviewing(null)}
        onUse={(look, publishNow) => {
          setPreviewing(null)
          setUsing({ look, publishNow })
        }}
      />
      <UseLookDialog
        request={using}
        documents={documents}
        themeHasChanges={themeDraft.data?.has_unpublished_changes === true}
        canPublish={canPublish}
        onClose={() => setUsing(null)}
        onDone={(outcome) => {
          setUsing(null)
          setReview(outcome)
          const name = outcome.look.name
          if (outcome.published) {
            toast.success(t('use.live', { name }))
            return
          }
          if (outcome.error) {
            toast.error(t('review.publishFailed', { message: outcome.error }))
            return
          }
          const media = outcome.result.imported?.media ?? 0
          toast.success(`${t('use.ready', { name })}${media ? ` ${tc('use.media', media)}` : ''}`)
        }}
      />
    </Card>
  )
}
