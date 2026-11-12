import { useState } from 'react'
import { Link } from 'react-router'
import { CircleCheckIcon, ExternalLinkIcon, Loader2Icon, PaletteIcon, PencilIcon, SendIcon, SparklesIcon, TriangleAlertIcon } from 'lucide-react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { ErrorState, LoadingState } from '@/components/common/state-views'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { useThemeDraftQuery, useThemePresetsQuery } from '@/features/storefront/api'
import { ApiError } from '@/lib/api/client'
import type { DocumentSummary } from '../api'
import { usePublishAllMutation, useSiteTemplatesQuery, useStartFromDemoMutation, type BuilderTemplate, type DemoParts, type StartFromDemoResult, type TemplatePreset } from '../templates/api'
import { TemplateThumbnail } from '../templates/template-thumbnail'
import { liveUrl } from './page-helpers'

/*
 * "Start from a demo look" on the pages list (B5): the three demo stores' looks (site templates),
 * a dialog choosing what is replaced — always as drafts — then a review panel with preview links
 * and Publish all. The live store changes only on publish.
 */

type PartKey = keyof DemoParts

const PARTS: { key: PartKey; label: string; detail: string }[] = [
  { key: 'theme', label: 'Site styles', detail: 'Colours, fonts, buttons and layout. Your logo, palette and contact details stay.' },
  { key: 'home', label: 'Home page', detail: 'The front page of your store.' },
  { key: 'header', label: 'Header', detail: 'The top of every page.' },
  { key: 'footer', label: 'Footer', detail: 'The bottom of every page.' },
  { key: 'listing_top', label: 'Shop pages', detail: 'The area above the product grid on shop, category, brand and search pages.' },
]

const ALL_PARTS: DemoParts = { theme: true, home: true, header: true, footer: true, listing_top: true }

/** The document a part replaces the draft of. */
function existingDocument(documents: DocumentSummary[], part: PartKey): DocumentSummary | undefined {
  switch (part) {
    case 'home':
      return documents.find((d) => d.kind === 'page' && d.key === 'home')
    case 'header':
    case 'footer':
      return documents.find((d) => d.kind === part)
    case 'listing_top':
      return documents.find((d) => d.key === 'zone:listing.top')
    default:
      return undefined
  }
}

const KIND_LABELS: Record<string, string> = { page: 'Page', header: 'Header', footer: 'Footer', zone: 'Shop pages' }

function isPreset(value: string | null): value is TemplatePreset {
  return value === 'vegan' || value === 'handmade' || value === 'classic'
}

function Swatches({ colors }: { colors: string[] }) {
  if (colors.length === 0) return null
  return (
    <span className="flex items-center gap-1" aria-hidden data-testid="demo-swatches">
      {colors.map((hex, i) => (
        <span key={`${hex}-${i}`} title={hex} className="size-4 rounded-full border border-black/10" style={{ backgroundColor: hex }} />
      ))}
    </span>
  )
}

/* ---------------------------------------------------------------------------------------------- */

function DemoLookDialog({ look, documents, themeHasChanges, onClose, onApplied }: { look: BuilderTemplate | null; documents: DocumentSummary[]; themeHasChanges: boolean; onClose: () => void; onApplied: (result: StartFromDemoResult, include: DemoParts, look: BuilderTemplate) => void }) {
  const start = useStartFromDemoMutation()
  const [include, setInclude] = useState<DemoParts>(ALL_PARTS)
  const chosen = PARTS.filter((part) => include[part.key])
  const close = () => {
    setInclude(ALL_PARTS)
    start.reset()
    onClose()
  }
  const replaced = (part: PartKey) => (part === 'theme' ? themeHasChanges : existingDocument(documents, part)?.has_unpublished_changes === true)
  const error = start.error instanceof ApiError ? start.error.message : start.error ? 'The look couldn’t be applied. Try again.' : null

  return (
    <Dialog open={look !== null} onOpenChange={(open) => !open && close()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Use the {look?.name} look?</DialogTitle>
          <DialogDescription>These parts of your store get the demo’s design as drafts. Your live store doesn’t change until you publish.</DialogDescription>
        </DialogHeader>
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-2 text-sm font-medium">Replace the drafts of</legend>
          {PARTS.map((part) => (
            <div key={part.key} className="flex items-start gap-3">
              <Checkbox id={`demo-part-${part.key}`} checked={include[part.key]} onCheckedChange={(checked) => setInclude((current) => ({ ...current, [part.key]: checked === true }))} className="mt-0.5" />
              <div className="flex flex-col gap-0.5">
                <Label htmlFor={`demo-part-${part.key}`}>{part.label}</Label>
                <span className="text-xs text-muted-foreground">{part.detail}</span>
                {include[part.key] && replaced(part.key) && (
                  <span className="flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400" data-testid={`demo-warning-${part.key}`}>
                    <TriangleAlertIcon className="size-3.5 shrink-0" aria-hidden /> Your unpublished changes here will be replaced.
                  </span>
                )}
              </div>
            </div>
          ))}
        </fieldset>
        <p className="rounded-md bg-muted px-3 py-2 text-sm">Your live store doesn’t change until you publish. Published versions stay in each page’s history.</p>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={close}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={chosen.length === 0 || start.isPending || !look || !isPreset(look.preset)}
            onClick={() => {
              if (!look || !isPreset(look.preset)) return
              const applied = { ...include }
              start.mutate(
                { preset: look.preset, include: applied },
                {
                  onSuccess: (result) => {
                    onApplied(result, applied, look)
                    close()
                  },
                },
              )
            }}
          >
            {start.isPending && <Loader2Icon className="animate-spin" aria-hidden />}
            Create drafts
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ---------------------------------------------------------------------------------------------- */

type Review = { look: BuilderTemplate; result: StartFromDemoResult; include: DemoParts; published: boolean }

function ReviewPanel({ review, canPublish, onPublished, onClose }: { review: Review; canPublish: boolean; onPublished: () => void; onClose: () => void }) {
  const publishAll = usePublishAllMutation()
  const [confirming, setConfirming] = useState(false)
  const { documents } = review.result
  const home = documents.find((d) => d.kind === 'page' && d.key === 'home')
  const themePreview = review.result.theme?.preview_url ?? home?.preview_url ?? documents.find((d) => d.preview_url)?.preview_url ?? null
  const count = documents.length + (review.include.theme ? 1 : 0)
  const storeUrl = home ? liveUrl(home) : null
  const error = publishAll.error ? (publishAll.error instanceof Error ? publishAll.error.message : 'Publishing failed.') : null

  const publish = () =>
    publishAll.mutate(
      { documents: documents.map((d) => d.id), theme: review.include.theme, note: `${review.look.name} demo look` },
      {
        onSuccess: () => {
          toast.success(`The ${review.look.name} look is live.`)
          onPublished()
        },
      },
    )

  return (
    <Card data-testid="demo-review" role="region" aria-labelledby="demo-review-title">
      <CardHeader>
        <CardTitle id="demo-review-title" role="heading" aria-level={2} aria-live="polite" className="flex items-center gap-2">
          {review.published ? <CircleCheckIcon className="size-5 text-emerald-600" aria-hidden /> : <SparklesIcon className="size-5" aria-hidden />}
          {review.published ? `The ${review.look.name} look is live` : `Review your ${review.look.name} look`}
        </CardTitle>
        <CardDescription>
          {review.published
            ? 'Every part below is published. Earlier versions stay in each page’s history.'
            : 'These drafts are ready. Preview each one on your store, change anything in the builder, then publish them together. Your live store doesn’t change until you publish.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <ul className="divide-y" aria-label="Drafts of the new look">
          {review.include.theme && (
            <li className="flex flex-wrap items-center gap-3 py-3" data-testid="demo-review-theme">
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 font-medium">
                  <PaletteIcon className="size-4 text-muted-foreground" aria-hidden /> Site styles
                </p>
                <p className="text-sm text-muted-foreground">Colours, fonts, buttons and layout</p>
              </div>
              <Badge variant={review.published ? 'success' : 'soft'}>{review.published ? 'Published' : 'Draft'}</Badge>
              <div className="flex flex-wrap items-center gap-1">
                <Button variant="outline" size="sm" asChild>
                  <Link to="/storefront/theme" aria-label="Edit the site styles">
                    <PencilIcon aria-hidden /> Edit
                  </Link>
                </Button>
                {themePreview && !review.published && (
                  <Button variant="ghost" size="sm" asChild>
                    <a href={themePreview} target="_blank" rel="noopener noreferrer" aria-label="Preview the site styles (opens in a new tab)">
                      <ExternalLinkIcon aria-hidden /> Preview
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
                <p className="text-sm text-muted-foreground">{KIND_LABELS[doc.kind] ?? 'Page'}</p>
              </div>
              <Badge variant={review.published ? 'success' : 'soft'}>{review.published ? 'Published' : 'Draft'}</Badge>
              <div className="flex flex-wrap items-center gap-1">
                <Button variant="outline" size="sm" asChild>
                  <Link to={`/storefront/builder/${doc.id}`} aria-label={`Edit ${doc.title}`}>
                    <PencilIcon aria-hidden /> Edit
                  </Link>
                </Button>
                {doc.preview_url && !review.published && (
                  <Button variant="ghost" size="sm" asChild>
                    <a href={doc.preview_url} target="_blank" rel="noopener noreferrer" aria-label={`Preview ${doc.title} (opens in a new tab)`}>
                      <ExternalLinkIcon aria-hidden /> Preview
                    </a>
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-3">
          {review.published ? (
            <>
              {storeUrl && (
                <Button variant="outline" asChild>
                  <a href={storeUrl} target="_blank" rel="noopener noreferrer">
                    <ExternalLinkIcon aria-hidden /> View your store
                  </a>
                </Button>
              )}
              <Button variant="ghost" onClick={onClose}>
                Close
              </Button>
            </>
          ) : (
            <>
              <Button disabled={!canPublish || publishAll.isPending || count === 0} onClick={() => setConfirming(true)}>
                {publishAll.isPending ? <Loader2Icon className="animate-spin" aria-hidden /> : <SendIcon aria-hidden />}
                Publish all
              </Button>
              <Button variant="ghost" onClick={onClose}>
                Done for now
              </Button>
              {!canPublish && <p className="text-sm text-muted-foreground">Someone with permission to publish makes these drafts live.</p>}
            </>
          )}
        </div>
      </CardContent>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Publish your new look?"
        description={`${count === 1 ? 'This part goes' : `These ${count} parts go`} live for shoppers right away. Earlier versions stay in each page’s history, so you can go back.`}
        confirmLabel="Publish all"
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

/** The "Start from a demo look" card (people who manage the store), or the review of the drafts it made. */
export function DemoLooksCard({ documents, canManage, canPublish }: { documents: DocumentSummary[]; canManage: boolean; canPublish: boolean }) {
  const looks = useSiteTemplatesQuery(canManage)
  const presets = useThemePresetsQuery()
  const themeDraft = useThemeDraftQuery()
  const [chosen, setChosen] = useState<BuilderTemplate | null>(null)
  const [review, setReview] = useState<Review | null>(null)

  if (!canManage) return null
  if (review) {
    return <ReviewPanel review={review} canPublish={canPublish} onPublished={() => setReview({ ...review, published: true })} onClose={() => setReview(null)} />
  }

  const sites = (looks.data ?? []).filter((t) => t.scope === 'site' && isPreset(t.preset))
  if (looks.isSuccess && sites.length === 0) return null
  const colorsOf = (preset: string | null) => {
    const colors = presets.data?.find((p) => p.key === preset)?.theme.colors as Record<string, string | null | undefined> | undefined
    if (!colors) return []
    return ['primary', 'accent', 'highlight', 'heading', 'canvas'].map((key) => colors[key]).filter((hex): hex is string => typeof hex === 'string')
  }

  return (
    <Card data-testid="demo-looks">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SparklesIcon className="size-5" aria-hidden /> Start from a demo look
        </CardTitle>
        <CardDescription>Give your store a complete design in one go: site styles, home page, header, footer and shop pages. Everything is created as drafts you can review and change first.</CardDescription>
      </CardHeader>
      <CardContent>
        {looks.isPending ? (
          <LoadingState rows={2} label="Loading demo looks" />
        ) : looks.error ? (
          <ErrorState title="The demo looks couldn’t be loaded" error={looks.error} onRetry={() => void looks.refetch()} />
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-label="Demo looks">
            {sites.map((look) => (
              <li key={look.id} className="flex flex-col gap-3 rounded-lg border p-3" data-testid={`demo-look-${look.preset}`}>
                <TemplateThumbnail template={look} />
                <div className="flex flex-1 flex-col gap-1">
                  <p className="flex items-center justify-between gap-2 font-medium">
                    {look.name}
                    <Swatches colors={colorsOf(look.preset)} />
                  </p>
                  {look.description && <p className="text-sm text-muted-foreground">{look.description}</p>}
                </div>
                <Button variant="outline" size="sm" aria-label={`Use the ${look.name} look`} onClick={() => setChosen(look)}>
                  Use this look
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      <DemoLookDialog
        look={chosen}
        documents={documents}
        themeHasChanges={themeDraft.data?.has_unpublished_changes === true}
        onClose={() => setChosen(null)}
        onApplied={(result, include, look) => {
          const media = result.imported?.media ?? 0
          toast.success(`The ${look.name} look is ready as drafts.${media ? ` ${media} ${media === 1 ? 'image was' : 'images were'} added to your media library.` : ''} Review it, then publish.`)
          setReview({ look, result, include, published: false })
        }}
      />
    </Card>
  )
}
