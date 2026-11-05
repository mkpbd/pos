import { useState } from 'react'
import { ArrowDownIcon, ArrowUpIcon, Loader2Icon, PencilIcon, PlusIcon, Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { FormField } from '@/components/common/form-field'
import { EmptyState, ErrorState, LoadingState } from '@/components/common/state-views'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { useCan } from '@/features/auth/use-auth'
import { useMediaLookup } from '@/features/media/api'
import { MediaField, MediaThumb } from '@/features/media/components/media-picker'
import {
  BANNER_PLACEMENT_LABELS,
  BANNER_PLACEMENTS,
  POPUP_DELAY,
  POPUP_FREQUENCIES,
  POPUP_FREQUENCY_LABELS,
  useBannersQuery,
  useDeleteBannerMutation,
  useReorderBannersMutation,
  useSaveBannerMutation,
  type Banner,
  type BannerInput,
  type BannerPlacement,
  type PopupFrequency,
  type TextPosition,
} from '@/features/storefront/api'
import { ColorField } from '@/features/storefront/components/color-field'
import { StorefrontHeader } from '@/features/storefront/components/storefront-header'
import { isSafeLink } from '@/features/storefront/menu-tree'
import { fromLocalInput, toLocalInput } from '@/features/storefront/schedule'
import { ApiError } from '@/lib/api/client'
import { BanglaTranslations } from '@/features/translations/components/bangla-translations'
import { bnErrors, readBn, toTranslationsInput, validateBn, type BnValues, type TranslationField } from '@/features/translations/translations'
import { fieldErrorMap } from '@/lib/forms'

type Draft = Omit<BannerInput, 'starts_at' | 'ends_at' | 'desktop_media_id' | 'popup_delay_seconds' | 'popup_frequency'> & {
  desktop_media_id: string | null
  starts_at: string
  ends_at: string
  /** Popup only: seconds as typed. */
  popup_delay: string
  popup_frequency: PopupFrequency
}

const PLACEMENT_HINTS: Record<BannerPlacement, string> = {
  hero_slider: 'Wide slides (about 1600×600) for hero slider sections.',
  home_promo: 'Tiles (about 800×600) for banner grid sections.',
  popup: 'A window over the store (about 800×800), not on the cart, checkout or account pages. Only the first live popup is shown.',
}

const toDraft = (placement: BannerPlacement, b?: Banner): Draft => ({
  placement: b?.placement ?? placement,
  name: b?.name ?? '',
  kicker: b?.kicker ?? null,
  title: b?.title ?? null,
  subtitle: b?.subtitle ?? null,
  link_url: b?.link_url ?? null,
  button_label: b?.button_label ?? null,
  secondary_link_url: b?.secondary_link_url ?? null,
  secondary_button_label: b?.secondary_button_label ?? null,
  desktop_media_id: b?.desktop_media_id ?? null,
  mobile_media_id: b?.mobile_media_id ?? null,
  text_color: b?.text_color ?? '#ffffff',
  text_position: b?.text_position ?? 'left',
  starts_at: toLocalInput(b?.starts_at ?? null),
  ends_at: toLocalInput(b?.ends_at ?? null),
  is_active: b?.is_active ?? true,
  popup_delay: String(b?.popup_delay_seconds ?? POPUP_DELAY.default),
  popup_frequency: b?.popup_frequency ?? 'once_per_day',
})

/** "After 5 s · once a day" for a popup banner's row. */
function popupSummary(b: Banner): string {
  const delay = b.popup_delay_seconds ?? POPUP_DELAY.default
  const frequency = POPUP_FREQUENCY_LABELS[b.popup_frequency ?? 'once_per_day'].toLowerCase()
  return `${delay === 0 ? 'Opens right away' : `After ${delay} s`} · ${frequency}`
}

/** Translatable banner texts (E12b) with the base fields' limits; the second button is hero-only. */
const BANNER_TRANSLATIONS = [
  { name: 'kicker', max: 60 },
  { name: 'title', max: 120 },
  { name: 'subtitle', max: 255 },
  { name: 'button_label', max: 40 },
  { name: 'secondary_button_label', max: 40 },
] as const
const ALL_BANNER_TRANSLATION_NAMES = BANNER_TRANSLATIONS.map((f) => f.name)
const bannerTranslations = (placement: BannerPlacement) => BANNER_TRANSLATIONS.filter((f) => placement === 'hero_slider' || f.name !== 'secondary_button_label')

const text = (value: string | null) => value ?? ''
const nullable = (value: string) => (value.trim() === '' ? null : value.trim())

/** Client checks mirroring the API, keyed like its validation errors. */
function validateBanner(d: Draft): Record<string, string> {
  const errors: Record<string, string> = {}
  if (!d.name.trim()) errors.name = 'Enter a name (only staff see it).'
  if (!d.desktop_media_id) errors.desktop_media_id = 'Choose an image.'
  if (d.link_url && !isSafeLink(d.link_url)) errors.link_url = 'Use a site path such as /sale or an http(s) URL.'
  if (d.button_label && !d.link_url) errors.link_url = 'A button needs a link.'
  if (d.secondary_link_url && !isSafeLink(d.secondary_link_url)) errors.secondary_link_url = 'Use a site path such as /sale or an http(s) URL.'
  if (!!d.secondary_button_label !== !!d.secondary_link_url) errors.secondary_link_url = 'The second button needs both a label and a link.'
  if (d.starts_at && d.ends_at && d.ends_at <= d.starts_at) errors.ends_at = 'The end must be after the start.'
  if (d.placement === 'popup') {
    const delay = d.popup_delay.trim()
    if (!/^\d{1,2}$/.test(delay) || Number(delay) > POPUP_DELAY.max) errors.popup_delay_seconds = `Whole seconds from ${POPUP_DELAY.min} to ${POPUP_DELAY.max}.`
  }
  return errors
}

function BannerForm({ banner, placement, onDone }: { banner?: Banner; placement: BannerPlacement; onDone: () => void }) {
  const save = useSaveBannerMutation()
  const [draft, setDraft] = useState<Draft>(() => toDraft(placement, banner))
  const [bn, setBn] = useState<BnValues>(() => readBn(banner?.translations, ALL_BANNER_TRANSLATION_NAMES))
  const [errors, setErrors] = useState<Record<string, string>>({})
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }))
  const translatable = bannerTranslations(draft.placement)
  const labels: Record<(typeof BANNER_TRANSLATIONS)[number]['name'], string> = {
    kicker: 'Small heading',
    title: 'Headline',
    subtitle: 'Text',
    button_label: 'Button label',
    secondary_button_label: 'Second button label',
  }
  const bnFields: TranslationField[] = translatable.map((f) => ({ ...f, label: labels[f.name], base: draft[f.name] }))

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const local = { ...validateBanner(draft), ...validateBn(bn, translatable) }
    if (Object.keys(local).length > 0) return setErrors(local)
    const { popup_delay, popup_frequency, ...rest } = draft
    const input: Partial<BannerInput> = {
      ...rest,
      desktop_media_id: draft.desktop_media_id ?? undefined,
      starts_at: fromLocalInput(draft.starts_at),
      ends_at: fromLocalInput(draft.ends_at),
      ...(draft.placement === 'popup' ? { popup_delay_seconds: Number(popup_delay.trim()), popup_frequency } : {}),
      translations: toTranslationsInput(bn, translatable.map((f) => f.name), banner?.translations),
    }
    if (banner) delete input.placement
    save.mutate(
      { id: banner?.id, input },
      {
        onSuccess: () => {
          toast.success(banner ? 'Banner saved.' : 'Banner added.')
          onDone()
        },
        onError: (error) => setErrors(error instanceof ApiError && error.code !== 'VALIDATION_FAILED' ? { form: error.message } : fieldErrorMap(error)),
      },
    )
  }

  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>{banner ? 'Edit banner' : 'New banner'}</DialogTitle>
        <DialogDescription>{BANNER_PLACEMENT_LABELS[draft.placement]}. {PLACEMENT_HINTS[draft.placement]}</DialogDescription>
      </DialogHeader>

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Name" error={errors.name} hint="For you; visitors never see it.">
          <Input maxLength={80} value={draft.name} onChange={(e) => set({ name: e.target.value })} />
        </FormField>
        <div className="flex items-center gap-2 sm:pt-6">
          <Switch id="banner-active" checked={draft.is_active} onCheckedChange={(v) => set({ is_active: v })} />
          <Label htmlFor="banner-active">Active</Label>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label>Image</Label>
          <MediaField value={draft.desktop_media_id} onChange={(id) => set({ desktop_media_id: id })} title="Banner image" />
          {errors.desktop_media_id && <p className="text-sm text-destructive">{errors.desktop_media_id}</p>}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Mobile image (optional)</Label>
          <MediaField value={draft.mobile_media_id} onChange={(id) => set({ mobile_media_id: id })} title="Mobile banner image" />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Small heading" hint="Optional line above the headline.">
          <Input maxLength={60} value={text(draft.kicker)} onChange={(e) => set({ kicker: nullable(e.target.value) })} />
        </FormField>
        <FormField label="Headline" error={errors.title}>
          <Input maxLength={120} value={text(draft.title)} onChange={(e) => set({ title: nullable(e.target.value) })} />
        </FormField>
      </div>
      <FormField label="Text" error={errors.subtitle}>
        <Input maxLength={255} value={text(draft.subtitle)} onChange={(e) => set({ subtitle: nullable(e.target.value) })} />
      </FormField>

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Link" error={errors.link_url} hint="Without a button label, the whole banner is the link.">
          <Input placeholder="/pages/about-us" spellCheck={false} value={text(draft.link_url)} onChange={(e) => set({ link_url: nullable(e.target.value) })} />
        </FormField>
        <FormField label="Button label" error={errors.button_label}>
          <Input maxLength={40} value={text(draft.button_label)} onChange={(e) => set({ button_label: nullable(e.target.value) })} />
        </FormField>
        {draft.placement === 'hero_slider' && (
          <>
            <FormField label="Second button link" error={errors.secondary_link_url}>
              <Input spellCheck={false} value={text(draft.secondary_link_url)} onChange={(e) => set({ secondary_link_url: nullable(e.target.value) })} />
            </FormField>
            <FormField label="Second button label" error={errors.secondary_button_label}>
              <Input maxLength={40} value={text(draft.secondary_button_label)} onChange={(e) => set({ secondary_button_label: nullable(e.target.value) })} />
            </FormField>
          </>
        )}
      </div>

      {draft.placement === 'popup' && (
        <fieldset className="grid gap-4 rounded-md border p-3 sm:grid-cols-2">
          <legend className="px-1 text-sm font-medium">Popup</legend>
          <FormField label="Delay (seconds)" error={errors.popup_delay_seconds} hint={`How long after a page opens (${POPUP_DELAY.min}–${POPUP_DELAY.max}).`}>
            <Input type="number" inputMode="numeric" min={POPUP_DELAY.min} max={POPUP_DELAY.max} step={1} className="w-28" value={draft.popup_delay} onChange={(e) => set({ popup_delay: e.target.value })} />
          </FormField>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="popup-frequency">Show to each visitor</Label>
            <Select value={draft.popup_frequency} onValueChange={(v) => set({ popup_frequency: v as PopupFrequency })}>
              <SelectTrigger id="popup-frequency" aria-describedby="popup-frequency-hint" aria-invalid={errors.popup_frequency ? true : undefined}><SelectValue /></SelectTrigger>
              <SelectContent>
                {POPUP_FREQUENCIES.map((f) => <SelectItem key={f} value={f}>{POPUP_FREQUENCY_LABELS[f]}</SelectItem>)}
              </SelectContent>
            </Select>
            <p id="popup-frequency-hint" className={errors.popup_frequency ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'}>{errors.popup_frequency ?? 'Visitors can always close it.'}</p>
          </div>
        </fieldset>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <ColorField label="Text colour" value={draft.text_color} onChange={(v) => set({ text_color: v })} error={errors.text_color} />
        <FormField label="Text position">
          <Select value={draft.text_position} onValueChange={(v) => set({ text_position: v as TextPosition })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="left">Left</SelectItem>
              <SelectItem value="center">Centre</SelectItem>
              <SelectItem value="right">Right</SelectItem>
            </SelectContent>
          </Select>
        </FormField>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Show from" hint="Optional.">
          <Input type="datetime-local" value={draft.starts_at} onChange={(e) => set({ starts_at: e.target.value })} />
        </FormField>
        <FormField label="Show until" error={errors.ends_at} hint="Optional.">
          <Input type="datetime-local" value={draft.ends_at} onChange={(e) => set({ ends_at: e.target.value })} />
        </FormField>
      </div>

      <BanglaTranslations fields={bnFields} value={bn} onChange={setBn} errors={bnErrors(errors)} />

      {errors.form && <p role="alert" className="text-sm text-destructive">{errors.form}</p>}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>Cancel</Button>
        <Button type="submit" disabled={save.isPending}>
          {save.isPending && <Loader2Icon className="animate-spin" data-icon="inline-start" />} {banner ? 'Save banner' : 'Add banner'}
        </Button>
      </DialogFooter>
    </form>
  )
}

const BANNER_STATE: Record<Banner['state'], { label: string; variant: 'success' | 'soft' | 'info' | 'warning' }> = {
  live: { label: 'Live', variant: 'success' },
  inactive: { label: 'Inactive', variant: 'soft' },
  scheduled: { label: 'Scheduled', variant: 'info' },
  ended: { label: 'Ended', variant: 'warning' },
}

function BannerStatus({ banner }: { banner: Banner }) {
  const state = BANNER_STATE[banner.state]
  return <Badge variant={state.variant}>{state.label}</Badge>
}

function PlacementCard({ placement, banners, canManage, onEdit, onAdd, onDelete }: {
  placement: BannerPlacement
  banners: Banner[]
  canManage: boolean
  onEdit: (b: Banner) => void
  onAdd: () => void
  onDelete: (b: Banner) => void
}) {
  const reorder = useReorderBannersMutation()
  const { byId } = useMediaLookup(banners.map((b) => b.desktop_media_id))
  // The storefront shows a single popup: the first live one in this order.
  const shownPopupId = placement === 'popup' ? banners.find((b) => b.is_live)?.id : undefined

  const move = (index: number, direction: -1 | 1) => {
    const ids = banners.map((b) => b.id)
    const [moved] = ids.splice(index, 1)
    if (moved) ids.splice(index + direction, 0, moved)
    reorder.mutate({ placement, ids }, { onError: (e) => toast.error(e.message) })
  }

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
        <div>
          <CardTitle>{BANNER_PLACEMENT_LABELS[placement]}</CardTitle>
          <CardDescription>{PLACEMENT_HINTS[placement]}</CardDescription>
        </div>
        {canManage && <Button variant="outline" size="sm" onClick={onAdd}><PlusIcon data-icon="inline-start" /> Add banner</Button>}
      </CardHeader>
      <CardContent>
        {banners.length === 0 ? (
          <EmptyState title="No banners yet" />
        ) : (
          <ol className="flex flex-col divide-y" aria-label={`${BANNER_PLACEMENT_LABELS[placement]} banners`}>
            {banners.map((b, i) => (
              <li key={b.id} className="flex flex-wrap items-center gap-3 py-3">
                <MediaThumb id={b.desktop_media_id} byId={byId} className="h-14 w-24" />
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{b.name}</p>
                  <p className="truncate text-sm text-muted-foreground">{b.title ?? 'No headline'}</p>
                  {placement === 'popup' && <p className="text-sm text-muted-foreground">{popupSummary(b)}</p>}
                </div>
                {placement === 'popup' && b.is_live && b.id !== shownPopupId && <Badge variant="outline">Not shown (another popup comes first)</Badge>}
                <BannerStatus banner={b} />
                {canManage && (
                  <div className="flex items-center">
                    <Button variant="ghost" size="icon-sm" aria-label={`Move ${b.name} up`} disabled={i === 0 || reorder.isPending} onClick={() => move(i, -1)}><ArrowUpIcon /></Button>
                    <Button variant="ghost" size="icon-sm" aria-label={`Move ${b.name} down`} disabled={i === banners.length - 1 || reorder.isPending} onClick={() => move(i, 1)}><ArrowDownIcon /></Button>
                    <Button variant="ghost" size="icon-sm" aria-label={`Edit ${b.name}`} onClick={() => onEdit(b)}><PencilIcon /></Button>
                    <Button variant="ghost" size="icon-sm" aria-label={`Delete ${b.name}`} onClick={() => onDelete(b)}><Trash2Icon /></Button>
                  </div>
                )}
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  )
}

export function BannersPage() {
  const can = useCan()
  const canManage = can('storefront.manage')
  const banners = useBannersQuery()
  const remove = useDeleteBannerMutation()
  const [editing, setEditing] = useState<{ placement: BannerPlacement; banner?: Banner } | null>(null)
  const [deleting, setDeleting] = useState<Banner | null>(null)

  return (
    <div className="flex flex-col gap-6">
      <StorefrontHeader />
      {banners.isPending ? (
        <LoadingState label="Loading banners" />
      ) : banners.error ? (
        <ErrorState error={banners.error} onRetry={() => banners.refetch()} />
      ) : (
        BANNER_PLACEMENTS.map((placement) => (
          <PlacementCard
            key={placement}
            placement={placement}
            banners={banners.data.filter((b) => b.placement === placement)}
            canManage={canManage}
            onAdd={() => setEditing({ placement })}
            onEdit={(banner) => setEditing({ placement, banner })}
            onDelete={setDeleting}
          />
        ))
      )}

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-2xl">
          {editing && <BannerForm placement={editing.placement} banner={editing.banner} onDone={() => setEditing(null)} />}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Delete this banner?"
        description="A banner shown by a homepage section cannot be deleted; remove it from the section first."
        confirmLabel="Delete banner"
        pending={remove.isPending}
        onConfirm={() =>
          deleting &&
          remove.mutate(deleting.id, {
            onSuccess: () => {
              toast.success('Banner deleted.')
              setDeleting(null)
            },
            onError: (e) => {
              setDeleting(null)
              toast.error(e.message)
            },
          })
        }
      />
    </div>
  )
}
