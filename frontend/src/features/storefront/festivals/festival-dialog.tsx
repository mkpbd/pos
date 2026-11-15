import { useId, useState } from 'react'
import { Link } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { CircleCheckIcon, ExternalLinkIcon, Loader2Icon, PencilIcon, SendIcon, SparklesIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { usePromotionsQuery, type PromotionRow } from '@/features/promotions/api'
import { ScreenConfirm } from '@/features/store-builder/pages/screen-ui'
import { usePublishAllMutation } from '@/features/store-builder/templates/api'
import { cn } from '@/lib/utils'
import { festivalKeys, useFestivalSetupMutation, type Festival, type FestivalDocument } from './api'
import type { FestivalMessageKey } from './messages'
import { checkSetup, currentSetup, formatInstant, prefill, serverProblems, setupInput, type SetupForm, type SetupProblems } from './model'
import { useFestivalText, type FestivalText } from './text'

/*
 * The festival dialog: Set up (dates prefilled, what to make, the festival page's address, a
 * discount) → the drafts it made → Review & publish (the existing publish-all with the ids the
 * setup returned). Opened from the list straight on the review when drafts are ready.
 */

export type FestivalDialogRequest = { festival: Festival; mode: 'setup' | 'review' }

type Review = { documents: FestivalDocument[]; publishIds: string[]; startsAt: string; endsAt: string; published: boolean }

const STATUS_VARIANT: Record<FestivalDocument['status'], 'success' | 'soft' | 'warning'> = { published: 'success', changed: 'warning', unpublished: 'soft' }

function problemText(t: FestivalText['t'], problem: SetupProblems[keyof SetupProblems]): string | null {
  if (!problem) return null
  return typeof problem === 'string' ? t(problem) : problem.text
}

function displayName(festival: Festival, lang: string) {
  return lang === 'bn' ? festival.name_bn || festival.name : festival.name
}

/* ----------------------------------------------------------------------------------------------
 * Discount
 * -------------------------------------------------------------------------------------------- */

const NONE = ''

function promotionLabel(p: PromotionRow, t: FestivalText['t']): string {
  const value = p.type === 'percent' ? `${Number(p.value ?? 0)} %` : p.type === 'fixed' ? `৳${p.value ?? '0'}` : t('dialog.freeDelivery')
  const state = p.state === 'scheduled' ? ` · ${t('dialog.startsLater')}` : ''
  return `${p.name} (${value}${p.trigger === 'coupon' ? `, ${t('dialog.coupon')}` : ''})${state}`
}

function DiscountPicker({ value, onChange, endsAt, error }: { value: string | null; onChange: (id: string | null) => void; endsAt: string | null; error: string | null }) {
  const { t } = useFestivalText()
  const id = useId()
  const list = usePromotionsQuery({ page: 1, per_page: 100 })
  const options = (list.data?.items ?? []).filter((p) => p.state === 'active' || p.state === 'scheduled' || p.id === value)
  const chosen = options.find((p) => p.id === value)
  const endsEarly = chosen?.ends_at && endsAt ? Date.parse(chosen.ends_at) < Date.parse(endsAt) : false
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{t('dialog.discount')}</Label>
      <select
        id={id}
        value={value ?? NONE}
        disabled={list.isPending}
        aria-invalid={error ? true : undefined}
        aria-describedby={`${id}-help`}
        onChange={(e) => onChange(e.target.value === NONE ? null : e.target.value)}
        className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60"
      >
        <option value={NONE}>{list.isPending ? t('dialog.discountLoading') : t('dialog.discountNone')}</option>
        {options.map((p) => (
          <option key={p.id} value={p.id}>
            {promotionLabel(p, t)}
          </option>
        ))}
      </select>
      <p id={`${id}-help`} className="text-sm text-muted-foreground">
        {list.isError ? t('dialog.discountError') : t('dialog.discountHelp')}{' '}
        <Link to="/promotions" className="underline underline-offset-2">
          {t('dialog.discountLink')}
        </Link>
      </p>
      {endsEarly && <p className="text-sm text-amber-800 dark:text-amber-300">{t('dialog.discountEndsEarly')}</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  )
}

/* ----------------------------------------------------------------------------------------------
 * Setup
 * -------------------------------------------------------------------------------------------- */

function IncludeOption({ id, checked, onChange, label, help }: { id: string; checked: boolean; onChange: (on: boolean) => void; label: string; help: string }) {
  return (
    <div className="flex items-start gap-3 rounded-md border p-3">
      <Checkbox id={id} checked={checked} onCheckedChange={(on) => onChange(on === true)} aria-describedby={`${id}-help`} className="mt-0.5" />
      <div className="flex flex-col gap-0.5">
        <Label htmlFor={id}>{label}</Label>
        <p id={`${id}-help`} className="text-sm text-muted-foreground">
          {help}
        </p>
      </div>
    </div>
  )
}

function SetupStep({ festival, timeZone, canManage, onDone, onCancel }: { festival: Festival; timeZone: string | undefined; canManage: boolean; onDone: (review: Review) => void; onCancel: () => void }) {
  const { t, lang } = useFestivalText()
  const ids = useId()
  const setup = useFestivalSetupMutation()
  const [form, setForm] = useState<SetupForm>(() => prefill(festival, timeZone))
  const [submitted, setSubmitted] = useState(false)
  const [tributeDiscount, setTributeDiscount] = useState(false)
  const local = checkSetup(form, timeZone)
  const remote = serverProblems(setup.error)
  const show = (field: keyof SetupProblems) => problemText(t, (submitted ? local[field] : undefined) ?? remote[field])
  const set = (patch: Partial<SetupForm>) => {
    setForm((current) => ({ ...current, ...patch }))
    if (setup.error) setup.reset()
  }
  const name = displayName(festival, lang)
  const again = currentSetup(festival) !== null
  const showDiscount = festival.sale_wording || tributeDiscount

  const submit = () => {
    setSubmitted(true)
    if (Object.keys(local).length > 0) return
    const input = setupInput(festival, { ...form, discountId: showDiscount ? form.discountId : null }, timeZone)
    setup.mutate(
      { key: festival.key, input },
      {
        onSuccess: (result) =>
          onDone({ documents: result.documents, publishIds: result.publish_ids, startsAt: input.starts_at, endsAt: input.ends_at, published: false }),
      },
    )
  }

  const formError = show('form')
  return (
    <>
      <DialogHeader>
        <DialogTitle>{t('dialog.title', { name })}</DialogTitle>
        <DialogDescription>{t('dialog.text')}</DialogDescription>
      </DialogHeader>
      <form
        id="festival-setup"
        noValidate
        className="flex min-w-0 flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        {festival.next.expected && (festival.next.note || festival.next.note_bn) && (
          <p className="rounded-md border border-amber-300/70 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-500/40 dark:bg-amber-950/30 dark:text-amber-100">
            {t('expected.help')} {lang === 'bn' ? (festival.next.note_bn ?? festival.next.note) : (festival.next.note ?? festival.next.note_bn)}
          </p>
        )}
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium">{t('dialog.dates')}</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            {(['starts', 'ends'] as const).map((field) => {
              const error = show(field)
              return (
                <div key={field} className="flex flex-col gap-1.5">
                  <Label htmlFor={`${ids}-${field}`}>{t(field === 'starts' ? 'dialog.starts' : 'dialog.ends')}</Label>
                  <Input
                    id={`${ids}-${field}`}
                    type="datetime-local"
                    value={form[field]}
                    aria-invalid={error ? true : undefined}
                    aria-describedby={`${ids}-zone${error ? ` ${ids}-${field}-error` : ''}`}
                    onChange={(e) => set({ [field]: e.target.value })}
                  />
                  {error && (
                    <p id={`${ids}-${field}-error`} className="text-sm text-destructive">
                      {error}
                    </p>
                  )}
                </div>
              )
            })}
          </div>
          <p id={`${ids}-zone`} className="text-sm text-muted-foreground">
            {t('dialog.timeHelp', { zone: timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone })}
          </p>
        </fieldset>

        <fieldset className="flex flex-col gap-2" aria-describedby={show('include') ? `${ids}-include-error` : undefined}>
          <legend className="mb-1 text-sm font-medium">{t('dialog.make')}</legend>
          <IncludeOption id={`${ids}-landing`} checked={form.landing} onChange={(landing) => set({ landing })} label={t('dialog.landing')} help={t('dialog.landingHelp')} />
          {form.landing && (
            <div className="flex flex-col gap-1.5 pl-7">
              <Label htmlFor={`${ids}-slug`}>{t('dialog.slug')}</Label>
              <Input
                id={`${ids}-slug`}
                value={form.slug}
                maxLength={60}
                spellCheck={false}
                aria-invalid={show('slug') ? true : undefined}
                aria-describedby={`${ids}-slug-help`}
                onChange={(e) => set({ slug: e.target.value.toLowerCase() })}
              />
              <p id={`${ids}-slug-help`} className="text-sm text-muted-foreground">
                {t('dialog.slugHelp')} <span className="font-mono text-foreground">/p/{form.slug || '…'}</span>
              </p>
              {show('slug') && <p className="text-sm text-destructive">{show('slug')}</p>}
            </div>
          )}
          <IncludeOption id={`${ids}-hero`} checked={form.home_hero} onChange={(home_hero) => set({ home_hero })} label={t('dialog.hero')} help={t('dialog.heroHelp')} />
          <IncludeOption id={`${ids}-bar`} checked={form.bar} onChange={(bar) => set({ bar })} label={t('dialog.bar')} help={t('dialog.barHelp')} />
          {show('include') && (
            <p id={`${ids}-include-error`} className="text-sm text-destructive">
              {show('include')}
            </p>
          )}
        </fieldset>

        {!festival.sale_wording && (
          <div className="flex flex-col gap-2 rounded-md border p-3" data-testid="festival-tribute">
            <p className="text-sm">{t('tribute')}</p>
            <div className="flex items-center gap-2">
              <Checkbox id={`${ids}-tribute`} checked={tributeDiscount} onCheckedChange={(on) => setTributeDiscount(on === true)} />
              <Label htmlFor={`${ids}-tribute`} className="font-normal">
                {t('dialog.tributeDiscount')}
              </Label>
            </div>
          </div>
        )}
        {showDiscount && <DiscountPicker value={form.discountId} onChange={(discountId) => set({ discountId })} endsAt={setupInput(festival, form, timeZone).ends_at} error={show('discount')} />}

        {again && <p className="text-sm text-muted-foreground">{t('dialog.again')}</p>}
        {formError && (
          <p role="alert" className="text-sm text-destructive">
            {formError}
          </p>
        )}
      </form>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" form="festival-setup" disabled={!canManage || setup.isPending}>
          {setup.isPending ? <Loader2Icon className="animate-spin" aria-hidden /> : <SparklesIcon aria-hidden />}
          {setup.isPending ? t('dialog.making') : t('dialog.submit')}
        </Button>
      </DialogFooter>
    </>
  )
}

/* ----------------------------------------------------------------------------------------------
 * Review & publish
 * -------------------------------------------------------------------------------------------- */

function ReviewStep({ festival, review, timeZone, canPublish, onPublished, onClose }: {
  festival: Festival
  review: Review
  timeZone: string | undefined
  canPublish: boolean
  onPublished: () => void
  onClose: () => void
}) {
  const { t, lang } = useFestivalText()
  const queryClient = useQueryClient()
  const publishAll = usePublishAllMutation()
  const [confirming, setConfirming] = useState(false)
  const name = displayName(festival, lang)
  const from = formatInstant(lang, review.startsAt, timeZone)
  const to = formatInstant(lang, review.endsAt, timeZone)
  const failure = publishAll.error ? t('review.failed', { message: publishAll.error instanceof Error ? publishAll.error.message : '' }) : null

  const publish = () =>
    publishAll.mutate(
      { documents: review.publishIds, theme: false, note: `${festival.name} ${festival.next.year}` },
      {
        onSuccess: () => {
          void queryClient.invalidateQueries({ queryKey: festivalKeys.all })
          toast.success(t('review.published'))
          onPublished()
        },
      },
    )

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2" aria-live="polite">
          {review.published ? <CircleCheckIcon className="size-5 text-emerald-600" aria-hidden /> : <SparklesIcon className="size-5" aria-hidden />}
          {review.published ? t('review.liveTitle', { name }) : t('review.title', { name })}
        </DialogTitle>
        <DialogDescription>{review.published ? t('review.liveText', { from, to }) : t('review.text')}</DialogDescription>
      </DialogHeader>
      {!review.published && <p className="text-sm font-medium">{t('setup.window', { from, to })}</p>}
      <ul className="divide-y rounded-md border" aria-label={t('review.list')} data-testid="festival-review">
        {review.documents.map((doc) => {
          const status = review.published ? 'published' : doc.status
          return (
            <li key={doc.id} className="flex flex-wrap items-center gap-3 p-3" data-testid={`festival-doc-${doc.role}`}>
              <div className="min-w-0 flex-1">
                <p className="font-medium break-words">{doc.title}</p>
                <p className="text-sm text-muted-foreground">{t(`review.role.${doc.role}` as FestivalMessageKey)}</p>
              </div>
              <Badge variant={STATUS_VARIANT[status] ?? 'soft'}>{t(`review.status.${status}` as FestivalMessageKey)}</Badge>
              <div className="flex flex-wrap items-center gap-1">
                <Button variant="outline" size="sm" asChild>
                  <Link to={`/storefront/builder/${doc.id}`} aria-label={t('review.editAria', { name: doc.title })}>
                    <PencilIcon aria-hidden /> {t('review.edit')}
                  </Link>
                </Button>
                {doc.preview_url && !review.published && (
                  <Button variant="ghost" size="sm" asChild>
                    <a href={doc.preview_url} target="_blank" rel="noopener noreferrer" aria-label={t('review.previewAria', { name: doc.title })}>
                      <ExternalLinkIcon aria-hidden /> {t('review.preview')}
                    </a>
                  </Button>
                )}
              </div>
            </li>
          )
        })}
      </ul>
      {failure && (
        <p role="alert" className="text-sm text-destructive">
          {failure}
        </p>
      )}
      {!canPublish && !review.published && <p className="text-sm text-muted-foreground">{t('review.noPermission')}</p>}
      <DialogFooter>
        {review.published ? (
          <Button type="button" onClick={onClose}>
            {t('review.close')}
          </Button>
        ) : (
          <>
            <Button type="button" variant="outline" onClick={onClose}>
              {t('review.later')}
            </Button>
            <Button type="button" disabled={!canPublish || publishAll.isPending || review.publishIds.length === 0} onClick={() => setConfirming(true)}>
              {publishAll.isPending ? <Loader2Icon className="animate-spin" aria-hidden /> : <SendIcon aria-hidden />}
              {publishAll.isPending ? t('review.publishing') : t('review.publish')}
            </Button>
          </>
        )}
      </DialogFooter>
      <ScreenConfirm
        open={confirming}
        onOpenChange={setConfirming}
        title={t('review.confirmTitle')}
        description={t('review.confirmText')}
        confirmLabel={t('review.publish')}
        destructive={false}
        onConfirm={() => {
          setConfirming(false)
          publish()
        }}
      />
    </>
  )
}

/* ---------------------------------------------------------------------------------------------- */

function initialReview(festival: Festival): Review | null {
  const setup = currentSetup(festival)
  if (!setup) return null
  return {
    documents: setup.documents,
    publishIds: setup.documents.filter((d) => d.status !== 'published').map((d) => d.id),
    startsAt: setup.starts_at,
    endsAt: setup.ends_at,
    published: false,
  }
}

function DialogBody({ request, timeZone, canManage, canPublish, onClose }: { request: FestivalDialogRequest; timeZone: string | undefined; canManage: boolean; canPublish: boolean; onClose: () => void }) {
  const [review, setReview] = useState<Review | null>(() => (request.mode === 'review' ? initialReview(request.festival) : null))
  if (review) {
    return (
      <ReviewStep
        festival={request.festival}
        review={review}
        timeZone={timeZone}
        canPublish={canPublish}
        onPublished={() => setReview({ ...review, published: true })}
        onClose={onClose}
      />
    )
  }
  return <SetupStep festival={request.festival} timeZone={timeZone} canManage={canManage} onDone={setReview} onCancel={onClose} />
}

export function FestivalDialog({ request, timeZone, canManage, canPublish, onClose }: {
  request: FestivalDialogRequest | null
  timeZone: string | undefined
  canManage: boolean
  canPublish: boolean
  onClose: () => void
}) {
  const { lang } = useFestivalText()
  return (
    <Dialog open={request !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent lang={lang} className={cn('max-h-[92svh] overflow-y-auto sm:max-w-2xl')}>
        {request && <DialogBody key={`${request.festival.key}:${request.mode}`} request={request} timeZone={timeZone} canManage={canManage} canPublish={canPublish} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  )
}
