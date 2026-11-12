import { useEffect, useRef, useState } from 'react'
import { CheckIcon, ExternalLinkIcon, Loader2Icon, SendIcon, TriangleAlertIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { ApiError } from '@/lib/api/client'
import type { DocumentSummary } from '../api'
import { isSitePreset, usePublishAllMutation, useStartFromDemoMutation, type BuilderTemplate, type DemoParts, type StartFromDemoResult } from '../templates/api'
import { TemplateThumbnail } from '../templates/template-thumbnail'
import { useScreenText } from './screen-language'
import { ScreenConfirm } from './screen-ui'

/*
 * The dialogs of a shop look (B7): Preview (the tall picture of its whole home page, what you get,
 * the two ways to use it) and Use (which parts change; save as drafts, or use and publish now —
 * start-from-demo, then publish-all, after a confirm; needs `storefront.publish`).
 */

export type PartKey = keyof DemoParts

const PART_KEYS: PartKey[] = ['theme', 'home', 'header', 'footer', 'listing_top']

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

export function Swatches({ colors, label, size = 'sm' }: { colors: string[]; label: string; size?: 'sm' | 'md' }) {
  if (colors.length === 0) return null
  return (
    <span className="flex items-center gap-1" role="img" aria-label={label} data-testid="demo-swatches">
      {colors.map((hex, i) => (
        <span key={`${hex}-${i}`} title={hex} className={size === 'md' ? 'size-5 rounded-full border border-black/10' : 'size-4 rounded-full border border-black/10'} style={{ backgroundColor: hex }} />
      ))}
    </span>
  )
}

/* ---------------------------------------------------------------------------------------------- */

/** The tall picture of the look's whole home page; else its thumbnail; else the drawn placeholder. */
function PreviewPicture({ look }: { look: BuilderTemplate }) {
  const { t } = useScreenText()
  const [failed, setFailed] = useState<string[]>([])
  const url = [look.preview_url, look.thumbnail_url].find((u): u is string => !!u && !failed.includes(u))
  if (!url) return <TemplateThumbnail template={{ ...look, thumbnail_url: null }} />
  return (
    <img
      src={url}
      alt={t('preview.imageAlt', { name: look.name })}
      decoding="async"
      draggable={false}
      onError={() => setFailed((list) => [...list, url])}
      className="block w-full"
      data-testid="look-preview-image"
    />
  )
}

export function PreviewDialog({
  look,
  colors,
  demoUrl,
  canPublish,
  onClose,
  onUse,
}: {
  look: BuilderTemplate | null
  colors: string[]
  demoUrl: string | null
  canPublish: boolean
  onClose: () => void
  onUse: (look: BuilderTemplate, publishNow: boolean) => void
}) {
  const { lang, t } = useScreenText()
  // Handing over to the use dialog: focus must not jump back to the card (it would close that dialog).
  const handingOver = useRef(false)
  const use = (chosen: BuilderTemplate, publishNow: boolean) => {
    handingOver.current = true
    onUse(chosen, publishNow)
  }
  return (
    <Dialog open={look !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        lang={lang}
        className="max-h-[92dvh] overflow-y-auto sm:max-w-4xl"
        data-testid="look-preview"
        onCloseAutoFocus={(event) => {
          if (handingOver.current) event.preventDefault()
          handingOver.current = false
        }}
      >
        {look && (
          <>
            <DialogHeader>
              <DialogTitle>{look.name}</DialogTitle>
              {look.description && <DialogDescription>{look.description}</DialogDescription>}
            </DialogHeader>
            <div className="grid gap-5 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
              <div className="flex flex-col gap-1.5">
                {/* Scrolls inside the dialog: the picture is the whole page, top to bottom. */}
                <div className="max-h-[60dvh] overflow-y-auto rounded-lg border bg-muted" tabIndex={0} aria-label={t('preview.scrollHint')} data-testid="look-preview-scroll">
                  <PreviewPicture key={look.id} look={look} />
                </div>
                <p className="text-xs text-muted-foreground">{t('preview.scrollHint')}</p>
              </div>
              <div className="flex flex-col gap-4">
                <Swatches colors={colors} label={t('looks.colours')} size="md" />
                <div className="flex flex-col gap-2">
                  <h3 className="font-semibold">{t('preview.youGet')}</h3>
                  <ul className="flex flex-col gap-1.5 text-sm">
                    {PART_KEYS.map((part) => (
                      <li key={part} className="flex items-start gap-2">
                        <CheckIcon className="mt-0.5 size-4 shrink-0 text-success-soft-foreground" aria-hidden /> {t(`preview.get.${part}` as const)}
                      </li>
                    ))}
                  </ul>
                  <p className="text-xs text-muted-foreground">{t('preview.keep')}</p>
                </div>
                <div className="mt-auto flex flex-col gap-2">
                  <Button onClick={() => use(look, false)}>{t('looks.use')}</Button>
                  <Button variant="outline" disabled={!canPublish} onClick={() => use(look, true)}>
                    <SendIcon aria-hidden /> {t('use.publishNow')}
                  </Button>
                  {!canPublish && <p className="text-xs text-muted-foreground">{t('use.noPublish')}</p>}
                  {demoUrl && (
                    <Button variant="ghost" asChild>
                      <a href={demoUrl} target="_blank" rel="noopener noreferrer" aria-label={t('looks.liveDemoAria', { name: look.name })}>
                        <ExternalLinkIcon aria-hidden /> {t('looks.liveDemo')}
                      </a>
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

/* ---------------------------------------------------------------------------------------------- */

export type UseRequest = { look: BuilderTemplate; publishNow: boolean }

/** How using a look ended: drafts made, made and published, or made but publishing failed. */
export type UseOutcome = { result: StartFromDemoResult; include: DemoParts; look: BuilderTemplate; published: boolean; error?: string }

export function UseLookDialog({
  request,
  documents,
  themeHasChanges,
  canPublish,
  onClose,
  onDone,
}: {
  request: UseRequest | null
  documents: DocumentSummary[]
  themeHasChanges: boolean
  canPublish: boolean
  onClose: () => void
  onDone: (outcome: UseOutcome) => void
}) {
  const { lang, t } = useScreenText()
  const start = useStartFromDemoMutation()
  const publishAll = usePublishAllMutation()
  const [include, setInclude] = useState<DemoParts>(ALL_PARTS)
  const [confirming, setConfirming] = useState(false)
  const [running, setRunning] = useState<'draft' | 'publish' | null>(null)
  // Opened with "Use and publish now" from the preview: the confirm shows straight away — once this
  // dialog is open, so the confirm is the top layer (opened together, the dialog would hide it).
  useEffect(() => {
    if (!request?.publishNow || !canPublish) return
    const timer = window.setTimeout(() => setConfirming(true), 0)
    return () => window.clearTimeout(timer)
  }, [request, canPublish])
  const look = request?.look ?? null
  const chosen = PART_KEYS.filter((part) => include[part])
  const busy = start.isPending || publishAll.isPending
  const usable = !!look && isSitePreset(look.preset)
  const close = () => {
    if (busy) return
    setInclude(ALL_PARTS)
    setConfirming(false)
    start.reset()
    publishAll.reset()
    onClose()
  }
  const replaced = (part: PartKey) => (part === 'theme' ? themeHasChanges : existingDocument(documents, part)?.has_unpublished_changes === true)
  const error = start.error instanceof ApiError ? start.error.message : start.error ? t('use.error') : null

  const finish = (outcome: UseOutcome) => {
    setInclude(ALL_PARTS)
    setConfirming(false)
    start.reset()
    publishAll.reset()
    onDone(outcome)
  }

  const run = async (publishNow: boolean) => {
    if (!look || !isSitePreset(look.preset)) return
    const applied = { ...include }
    setRunning(publishNow ? 'publish' : 'draft')
    let result: StartFromDemoResult
    try {
      result = await start.mutateAsync({ preset: look.preset, include: applied })
    } catch {
      return // shown in the dialog
    }
    if (!publishNow) {
      finish({ result, include: applied, look, published: false })
      return
    }
    try {
      await publishAll.mutateAsync({ documents: result.documents.map((d) => d.id), theme: applied.theme, note: `${look.name} demo look` })
      finish({ result, include: applied, look, published: true })
    } catch (failure) {
      // The drafts exist: the review shows them with what went wrong, ready to publish again.
      finish({ result, include: applied, look, published: false, error: failure instanceof Error ? failure.message : t('review.failed') })
    }
  }

  return (
    <Dialog open={request !== null} onOpenChange={(open) => !open && close()}>
      <DialogContent lang={lang} className="max-h-[92dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('use.title', { name: look?.name ?? '' })}</DialogTitle>
          <DialogDescription>{t('use.text')}</DialogDescription>
        </DialogHeader>
        <fieldset className="flex flex-col gap-3" disabled={busy}>
          <legend className="mb-2 text-sm font-medium">{t('use.legend')}</legend>
          {PART_KEYS.map((part) => (
            <div key={part} className="flex items-start gap-3">
              <Checkbox id={`demo-part-${part}`} checked={include[part]} onCheckedChange={(checked) => setInclude((current) => ({ ...current, [part]: checked === true }))} className="mt-0.5" />
              <div className="flex flex-col gap-0.5">
                <Label htmlFor={`demo-part-${part}`}>{t(`use.part.${part}` as const)}</Label>
                <span className="text-xs text-muted-foreground">{t(`use.part.${part}.detail` as const)}</span>
                {include[part] && replaced(part) && (
                  <span className="flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400" data-testid={`demo-warning-${part}`}>
                    <TriangleAlertIcon className="size-3.5 shrink-0" aria-hidden /> {t('use.warning')}
                  </span>
                )}
              </div>
            </div>
          ))}
        </fieldset>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5 rounded-lg border p-3">
            <Button type="button" variant="outline" disabled={chosen.length === 0 || busy || !usable} onClick={() => void run(false)}>
              {busy && running === 'draft' && <Loader2Icon className="animate-spin" aria-hidden />}
              {t('use.draft')}
            </Button>
            <p className="text-xs text-muted-foreground">{t('use.draftHint')}</p>
          </div>
          <div className="flex flex-col gap-1.5 rounded-lg border border-primary/40 p-3">
            <Button type="button" disabled={!canPublish || chosen.length === 0 || busy || !usable} onClick={() => setConfirming(true)}>
              {busy && running === 'publish' ? <Loader2Icon className="animate-spin" aria-hidden /> : <SendIcon aria-hidden />}
              {t('use.publishNow')}
            </Button>
            <p className="text-xs text-muted-foreground" data-testid="publish-now-hint">
              {canPublish ? t('use.publishNowHint') : t('use.noPublish')}
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" disabled={busy} onClick={close}>
            {t('common.cancel')}
          </Button>
        </DialogFooter>
      </DialogContent>
      <ScreenConfirm
        open={confirming}
        onOpenChange={setConfirming}
        title={t('use.confirmTitle')}
        description={t('use.confirmText')}
        confirmLabel={t('use.confirm')}
        destructive={false}
        onConfirm={() => {
          setConfirming(false)
          void run(true)
        }}
      />
    </Dialog>
  )
}
