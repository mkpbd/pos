import { useState, type ComponentType } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { FormField } from '@/components/common/form-field'
import { Button } from '@/components/ui/button'
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { MediaField } from '@/features/media/components/media-picker'
import {
  BANNER_PLACEMENT_HINTS,
  BANNER_PLACEMENT_LABELS,
  POPUP_DELAY,
  POPUP_FREQUENCIES,
  POPUP_FREQUENCY_LABELS,
  storefrontKeys,
  useSaveBannerMutation,
  type Banner,
  type BannerInput,
  type BannerPlacement,
  type PopupFrequency,
  type TextPosition,
} from '@/features/storefront/api'
import { ColorField } from '@/features/storefront/components/color-field'
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
const nullable = (value: string | null) => (value === null || value.trim() === '' ? null : value.trim())
/** While typing keep the text as is (trimming each keystroke would eat the space before the next word); trimmed on save. */
const typed = (value: string) => (value === '' ? null : value)
const TEXT_FIELDS = ['name', 'kicker', 'title', 'subtitle', 'link_url', 'button_label', 'secondary_link_url', 'secondary_button_label'] as const

function trimmed(d: Draft): Draft {
  const next = { ...d }
  for (const field of TEXT_FIELDS) {
    if (field === 'name') next.name = d.name.trim()
    else next[field] = nullable(d[field] ?? null)
  }
  return next
}

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

/**
 * Saves an edit of an existing banner somewhere other than PATCH /storefront/banners/{id} (the
 * store builder edits a page's banner copy-on-write); resolves with the saved banner and the
 * success message to show.
 */
export type BannerSave = (id: string, input: Partial<BannerInput>) => Promise<{ banner: Banner; message: string }>

/** A link target picker for the banner's links (the store builder's page / category / custom picker); a plain text box otherwise. */
export type BannerLinkInputProps = { label: string; value: string | null; onChange: (url: string | null) => void; error?: string; hint?: string }

/**
 * Add or edit one banner; mounted inside DialogContent. `onDone` gets the saved banner, or nothing
 * on cancel. `save` (edits only) replaces the default PATCH; `LinkInput` replaces the link boxes.
 */
export function BannerForm({ banner, placement, onDone, save: saveEdit, LinkInput }: {
  banner?: Banner
  placement: BannerPlacement
  onDone: (saved?: Banner) => void
  save?: BannerSave
  LinkInput?: ComponentType<BannerLinkInputProps>
}) {
  const save = useSaveBannerMutation()
  const queryClient = useQueryClient()
  const custom = useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<BannerInput> }) => {
      if (!saveEdit) throw new Error('No custom banner save.')
      return saveEdit(id, input)
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: storefrontKeys.banners }),
  })
  const pending = save.isPending || custom.isPending
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
    const clean = trimmed(draft)
    const local = { ...validateBanner(clean), ...validateBn(bn, translatable) }
    if (Object.keys(local).length > 0) return setErrors(local)
    const { popup_delay, popup_frequency, ...rest } = clean
    const input: Partial<BannerInput> = {
      ...rest,
      desktop_media_id: clean.desktop_media_id ?? undefined,
      starts_at: fromLocalInput(clean.starts_at),
      ends_at: fromLocalInput(clean.ends_at),
      ...(clean.placement === 'popup' ? { popup_delay_seconds: Number(popup_delay.trim()), popup_frequency } : {}),
      translations: toTranslationsInput(bn, translatable.map((f) => f.name), banner?.translations),
    }
    if (banner) delete input.placement
    const onError = (error: Error) => setErrors(error instanceof ApiError && error.code !== 'VALIDATION_FAILED' ? { form: error.message } : fieldErrorMap(error))
    if (banner && saveEdit) {
      custom.mutate(
        { id: banner.id, input },
        {
          onSuccess: (result) => {
            toast.success(result.message)
            onDone(result.banner)
          },
          onError,
        },
      )
      return
    }
    save.mutate(
      { id: banner?.id, input },
      {
        onSuccess: (saved) => {
          toast.success(banner ? 'Banner saved.' : 'Banner added.')
          onDone(saved)
        },
        onError,
      },
    )
  }

  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>{banner ? 'Edit banner' : 'New banner'}</DialogTitle>
        <DialogDescription>{BANNER_PLACEMENT_LABELS[draft.placement]}. {BANNER_PLACEMENT_HINTS[draft.placement]}</DialogDescription>
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
          <Input maxLength={60} value={text(draft.kicker)} onChange={(e) => set({ kicker: typed(e.target.value) })} />
        </FormField>
        <FormField label="Headline" error={errors.title}>
          <Input maxLength={120} value={text(draft.title)} onChange={(e) => set({ title: typed(e.target.value) })} />
        </FormField>
      </div>
      <FormField label="Text" error={errors.subtitle}>
        <Input maxLength={255} value={text(draft.subtitle)} onChange={(e) => set({ subtitle: typed(e.target.value) })} />
      </FormField>

      <div className="grid gap-4 sm:grid-cols-2">
        {LinkInput ? (
          <LinkInput label="Link" value={draft.link_url} onChange={(url) => set({ link_url: url === null ? null : typed(url) })} error={errors.link_url} hint="Without a button label, the whole banner is the link." />
        ) : (
          <FormField label="Link" error={errors.link_url} hint="Without a button label, the whole banner is the link.">
            <Input placeholder="/pages/about-us" spellCheck={false} value={text(draft.link_url)} onChange={(e) => set({ link_url: typed(e.target.value) })} />
          </FormField>
        )}
        <FormField label="Button label" error={errors.button_label}>
          <Input maxLength={40} value={text(draft.button_label)} onChange={(e) => set({ button_label: typed(e.target.value) })} />
        </FormField>
        {draft.placement === 'hero_slider' && (
          <>
            {LinkInput ? (
              <LinkInput label="Second button link" value={draft.secondary_link_url} onChange={(url) => set({ secondary_link_url: url === null ? null : typed(url) })} error={errors.secondary_link_url} />
            ) : (
              <FormField label="Second button link" error={errors.secondary_link_url}>
                <Input spellCheck={false} value={text(draft.secondary_link_url)} onChange={(e) => set({ secondary_link_url: typed(e.target.value) })} />
              </FormField>
            )}
            <FormField label="Second button label" error={errors.secondary_button_label}>
              <Input maxLength={40} value={text(draft.secondary_button_label)} onChange={(e) => set({ secondary_button_label: typed(e.target.value) })} />
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
        <Button type="button" variant="outline" onClick={() => onDone()}>Cancel</Button>
        <Button type="submit" disabled={pending}>
          {pending && <Loader2Icon className="animate-spin" data-icon="inline-start" />} {banner ? 'Save banner' : 'Add banner'}
        </Button>
      </DialogFooter>
    </form>
  )
}
