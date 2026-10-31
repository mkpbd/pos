import { useId, useState } from 'react'
import { ArrowDownIcon, ArrowUpIcon, Loader2Icon, PlusIcon, Trash2Icon, XIcon } from 'lucide-react'
import { toast } from 'sonner'
import { FormField } from '@/components/common/form-field'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { RichTextEditor } from '@/features/content/components/rich-text-editor'
import { useMediaLookup } from '@/features/media/api'
import { MediaField, MediaThumb } from '@/features/media/components/media-picker'
import {
  BANNER_GRID_LAYOUTS,
  FEATURE_ICONS,
  useBannersQuery,
  useSaveSectionMutation,
  type AnySectionConfig,
  type BannerGridLayout,
  type BannerPlacement,
  type FeatureIcon,
  type FeatureItem,
  type HomepageSection,
  type SectionConfigs,
  type SectionInput,
  type SectionTypeInfo,
  type TestimonialItem,
} from '@/features/storefront/api'
import { ColorField } from '@/features/storefront/components/color-field'
import { fromLocalInput, toLocalInput } from '@/features/storefront/schedule'
import { ApiError } from '@/lib/api/client'
import { fieldErrorMap } from '@/lib/forms'

type Errors = Record<string, string>

const LAYOUT_LABELS: Record<BannerGridLayout, string> = {
  '2-col': 'Two columns',
  '3-col': 'Three columns',
  '3-col-split': 'Three columns, middle split (4 banners)',
  '4-col': 'Four columns',
}
const ICON_LABELS: Record<FeatureIcon, string> = {
  truck: 'Delivery truck',
  'shield-check': 'Shield',
  'credit-card': 'Card',
  headset: 'Support',
  gift: 'Gift',
  'rotate-ccw': 'Returns',
  'badge-percent': 'Discount',
  clock: 'Clock',
  leaf: 'Leaf',
  heart: 'Heart',
  star: 'Star',
  store: 'Store',
}
const MAX_FEATURES = 6
const MAX_TESTIMONIALS = 12

function move<T>(list: T[], index: number, direction: -1 | 1): T[] {
  const target = index + direction
  if (target < 0 || target >= list.length) return list
  const copy = [...list]
  const [item] = copy.splice(index, 1)
  if (item !== undefined) copy.splice(target, 0, item)
  return copy
}

function OptionalColor({ label, value, onChange }: { label: string; value: string | null; onChange: (value: string | null) => void }) {
  const id = useId()

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Checkbox id={id} checked={value !== null} onCheckedChange={(v) => onChange(v === true ? '#f3f7fa' : null)} />
        <Label htmlFor={id}>{label}</Label>
      </div>
      {value !== null && <ColorField label={`${label} value`} value={value} onChange={onChange} />}
    </div>
  )
}

/** Picks banners of one placement and puts them in order. */
function BannerChooser({ placement, value, onChange, limits, error }: { placement: BannerPlacement; value: string[]; onChange: (ids: string[]) => void; limits: { min: number; max: number }; error?: string }) {
  const banners = useBannersQuery()
  const available = (banners.data ?? []).filter((b) => b.placement === placement)
  const byId = new Map(available.map((b) => [b.id, b]))
  const media = useMediaLookup(available.map((b) => b.desktop_media_id))
  const rest = available.filter((b) => !value.includes(b.id))

  return (
    <div className="flex flex-col gap-2">
      <Label>Banners ({value.length}, {limits.min === limits.max ? `exactly ${limits.min}` : `${limits.min}–${limits.max}`})</Label>
      {value.length > 0 && (
        <ol className="flex flex-col gap-2" aria-label="Chosen banners">
          {value.map((id, i) => {
            const banner = byId.get(id)
            return (
              <li key={id} className="flex items-center gap-3 rounded-md border p-2">
                {banner && <MediaThumb id={banner.desktop_media_id} byId={media.byId} className="h-10 w-16" />}
                <span className="min-w-0 flex-1 truncate text-sm">{banner?.name ?? 'Banner'}{banner && !banner.is_live && ' (not live)'}</span>
                <Button type="button" variant="ghost" size="icon-sm" aria-label={`Move ${banner?.name ?? 'banner'} up`} disabled={i === 0} onClick={() => onChange(move(value, i, -1))}><ArrowUpIcon /></Button>
                <Button type="button" variant="ghost" size="icon-sm" aria-label={`Move ${banner?.name ?? 'banner'} down`} disabled={i === value.length - 1} onClick={() => onChange(move(value, i, 1))}><ArrowDownIcon /></Button>
                <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove ${banner?.name ?? 'banner'}`} onClick={() => onChange(value.filter((x) => x !== id))}><XIcon /></Button>
              </li>
            )
          })}
        </ol>
      )}
      {rest.length > 0 && value.length < limits.max ? (
        <Select value="" onValueChange={(id) => onChange([...value, id])}>
          <SelectTrigger aria-label="Add a banner" className="w-full sm:w-72"><SelectValue placeholder="Add a banner…" /></SelectTrigger>
          <SelectContent>
            {rest.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
          </SelectContent>
        </Select>
      ) : (
        available.length === 0 && !banners.isPending && <p className="text-sm text-muted-foreground">No banners for this placement yet. Create them under Online store → Banners.</p>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  )
}

function FeaturesEditor({ items, onChange, errors }: { items: FeatureItem[]; onChange: (items: FeatureItem[]) => void; errors: Errors }) {
  const patch = (i: number, p: Partial<FeatureItem>) => onChange(items.map((item, j) => (j === i ? { ...item, ...p } : item)))

  return (
    <div className="flex flex-col gap-3">
      <Label>Features</Label>
      {items.map((item, i) => (
        <fieldset key={i} className="grid gap-3 rounded-md border p-3 sm:grid-cols-[10rem_1fr_auto]">
          <legend className="sr-only">Feature {i + 1}</legend>
          <Select value={item.icon} onValueChange={(v) => patch(i, { icon: v as FeatureIcon })}>
            <SelectTrigger aria-label={`Feature ${i + 1} icon`}><SelectValue /></SelectTrigger>
            <SelectContent>{FEATURE_ICONS.map((icon) => <SelectItem key={icon} value={icon}>{ICON_LABELS[icon]}</SelectItem>)}</SelectContent>
          </Select>
          <div className="flex flex-col gap-2">
            <Input aria-label={`Feature ${i + 1} title`} placeholder="Title" maxLength={60} value={item.title} aria-invalid={errors[`config.items.${i}.title`] ? true : undefined} onChange={(e) => patch(i, { title: e.target.value })} />
            {errors[`config.items.${i}.title`] && <p className="text-sm text-destructive">{errors[`config.items.${i}.title`]}</p>}
            <Input aria-label={`Feature ${i + 1} text`} placeholder="Short text (optional)" maxLength={160} value={item.text ?? ''} onChange={(e) => patch(i, { text: e.target.value || null })} />
          </div>
          <div className="flex items-start">
            <Button type="button" variant="ghost" size="icon-sm" aria-label={`Move feature ${i + 1} up`} disabled={i === 0} onClick={() => onChange(move(items, i, -1))}><ArrowUpIcon /></Button>
            <Button type="button" variant="ghost" size="icon-sm" aria-label={`Move feature ${i + 1} down`} disabled={i === items.length - 1} onClick={() => onChange(move(items, i, 1))}><ArrowDownIcon /></Button>
            <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove feature ${i + 1}`} onClick={() => onChange(items.filter((_, j) => j !== i))}><Trash2Icon /></Button>
          </div>
        </fieldset>
      ))}
      {items.length < MAX_FEATURES && (
        <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => onChange([...items, { icon: 'star', title: '', text: null }])}>
          <PlusIcon data-icon="inline-start" /> Add feature
        </Button>
      )}
      {errors['config.items'] && <p className="text-sm text-destructive">{errors['config.items']}</p>}
    </div>
  )
}

function TestimonialsEditor({ items, onChange, errors }: { items: TestimonialItem[]; onChange: (items: TestimonialItem[]) => void; errors: Errors }) {
  const patch = (i: number, p: Partial<TestimonialItem>) => onChange(items.map((item, j) => (j === i ? { ...item, ...p } : item)))

  return (
    <div className="flex flex-col gap-3">
      <Label>Quotes</Label>
      {items.map((item, i) => (
        <fieldset key={i} className="flex flex-col gap-3 rounded-md border p-3">
          <legend className="sr-only">Quote {i + 1}</legend>
          <Textarea aria-label={`Quote ${i + 1} text`} placeholder="What the customer said" maxLength={500} rows={2} value={item.quote} aria-invalid={errors[`config.items.${i}.quote`] ? true : undefined} onChange={(e) => patch(i, { quote: e.target.value })} />
          {errors[`config.items.${i}.quote`] && <p className="text-sm text-destructive">{errors[`config.items.${i}.quote`]}</p>}
          <div className="grid gap-3 sm:grid-cols-3">
            <Input aria-label={`Quote ${i + 1} name`} placeholder="Name" maxLength={80} value={item.name} aria-invalid={errors[`config.items.${i}.name`] ? true : undefined} onChange={(e) => patch(i, { name: e.target.value })} />
            <Input aria-label={`Quote ${i + 1} role`} placeholder="Role or area (optional)" maxLength={80} value={item.role ?? ''} onChange={(e) => patch(i, { role: e.target.value || null })} />
            <Select value={item.rating === null ? 'none' : String(item.rating)} onValueChange={(v) => patch(i, { rating: v === 'none' ? null : Number(v) })}>
              <SelectTrigger aria-label={`Quote ${i + 1} rating`}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No stars</SelectItem>
                {[5, 4, 3, 2, 1].map((n) => <SelectItem key={n} value={String(n)}>{n} star{n === 1 ? '' : 's'}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {errors[`config.items.${i}.name`] && <p className="text-sm text-destructive">{errors[`config.items.${i}.name`]}</p>}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <MediaField value={item.avatar_media_id} onChange={(id) => patch(i, { avatar_media_id: id })} title="Customer photo" />
            <div className="flex">
              <Button type="button" variant="ghost" size="icon-sm" aria-label={`Move quote ${i + 1} up`} disabled={i === 0} onClick={() => onChange(move(items, i, -1))}><ArrowUpIcon /></Button>
              <Button type="button" variant="ghost" size="icon-sm" aria-label={`Move quote ${i + 1} down`} disabled={i === items.length - 1} onClick={() => onChange(move(items, i, 1))}><ArrowDownIcon /></Button>
              <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove quote ${i + 1}`} onClick={() => onChange(items.filter((_, j) => j !== i))}><Trash2Icon /></Button>
            </div>
          </div>
        </fieldset>
      ))}
      {items.length < MAX_TESTIMONIALS && (
        <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => onChange([...items, { quote: '', name: '', role: null, rating: 5, avatar_media_id: null }])}>
          <PlusIcon data-icon="inline-start" /> Add quote
        </Button>
      )}
      {errors['config.items'] && <p className="text-sm text-destructive">{errors['config.items']}</p>}
    </div>
  )
}

/** The type-specific part of the form. */
function ConfigFields({ info, config, onChange, errors }: { info: SectionTypeInfo; config: AnySectionConfig; onChange: (config: AnySectionConfig) => void; errors: Errors }) {
  switch (info.type) {
    case 'hero_slider': {
      const c = config as SectionConfigs['hero_slider']
      return (
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Change slides">
            <Select value={String(c.autoplay_seconds)} onValueChange={(v) => onChange({ ...c, autoplay_seconds: Number(v) })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="0">Only by the visitor</SelectItem>
                {[4, 6, 8, 10, 15].map((s) => <SelectItem key={s} value={String(s)}>Every {s} seconds</SelectItem>)}
              </SelectContent>
            </Select>
          </FormField>
          <FormField label="Height">
            <Select value={c.height} onValueChange={(v) => onChange({ ...c, height: v as 'medium' | 'large' })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="large">Large</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
              </SelectContent>
            </Select>
          </FormField>
        </div>
      )
    }
    case 'banner_grid': {
      const c = config as SectionConfigs['banner_grid']
      return (
        <FormField label="Layout" error={errors['config.layout']}>
          <Select value={c.layout} onValueChange={(v) => onChange({ ...c, layout: v as BannerGridLayout })}>
            <SelectTrigger className="sm:w-80"><SelectValue /></SelectTrigger>
            <SelectContent>{BANNER_GRID_LAYOUTS.map((l) => <SelectItem key={l} value={l}>{LAYOUT_LABELS[l]}</SelectItem>)}</SelectContent>
          </Select>
        </FormField>
      )
    }
    case 'rich_text': {
      const c = config as SectionConfigs['rich_text']
      return (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="section-text">Text</Label>
            <RichTextEditor id="section-text" label="Section text" value={c.body_html} onChange={(body_html) => onChange({ ...c, body_html })} invalid={!!errors['config.body_html']} />
            {errors['config.body_html'] && <p className="text-sm text-destructive">{errors['config.body_html']}</p>}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Alignment">
              <Select value={c.alignment} onValueChange={(v) => onChange({ ...c, alignment: v as 'left' | 'center' })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="left">Left</SelectItem><SelectItem value="center">Centred</SelectItem></SelectContent>
              </Select>
            </FormField>
            <FormField label="Width">
              <Select value={c.width} onValueChange={(v) => onChange({ ...c, width: v as 'narrow' | 'wide' })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="narrow">Narrow (easy reading)</SelectItem><SelectItem value="wide">Full width</SelectItem></SelectContent>
              </Select>
            </FormField>
          </div>
          <OptionalColor label="Background colour" value={c.background} onChange={(background) => onChange({ ...c, background })} />
        </div>
      )
    }
    case 'features_strip': {
      const c = config as SectionConfigs['features_strip']
      return (
        <div className="flex flex-col gap-4">
          <FeaturesEditor items={c.items} onChange={(items) => onChange({ ...c, items })} errors={errors} />
          <OptionalColor label="Background colour" value={c.background} onChange={(background) => onChange({ ...c, background })} />
        </div>
      )
    }
    case 'testimonials': {
      const c = config as SectionConfigs['testimonials']
      return (
        <div className="flex flex-col gap-4">
          <TestimonialsEditor items={c.items} onChange={(items) => onChange({ ...c, items })} errors={errors} />
          <OptionalColor label="Background colour" value={c.background} onChange={(background) => onChange({ ...c, background })} />
        </div>
      )
    }
    case 'newsletter': {
      const c = config as SectionConfigs['newsletter']
      return (
        <div className="flex flex-col gap-4">
          <FormField label="Text" hint="Optional line under the title.">
            <Input maxLength={255} value={c.text ?? ''} onChange={(e) => onChange({ ...c, text: e.target.value || null })} />
          </FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Button label" error={errors['config.button_label']}>
              <Input maxLength={30} value={c.button_label} onChange={(e) => onChange({ ...c, button_label: e.target.value })} />
            </FormField>
            <div className="flex flex-col gap-1.5">
              <Label>Picture (optional)</Label>
              <MediaField value={c.image_media_id} onChange={(image_media_id) => onChange({ ...c, image_media_id })} title="Newsletter picture" />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <ColorField label="Background" value={c.background} onChange={(background) => onChange({ ...c, background })} error={errors['config.background']} />
            <ColorField label="Text colour" value={c.foreground} onChange={(foreground) => onChange({ ...c, foreground })} error={errors['config.foreground']} />
          </div>
        </div>
      )
    }
  }
}

type Draft = { title: string; subtitle: string; config: AnySectionConfig; bannerIds: string[]; isEnabled: boolean; startsAt: string; endsAt: string }

/** Client checks before saving, keyed like the API's validation errors. */
function validate(info: SectionTypeInfo, d: Draft): Errors {
  const errors: Errors = {}
  if (info.items) {
    let { min, max } = info.items
    if (info.type === 'banner_grid') {
      const layout = (d.config as SectionConfigs['banner_grid']).layout
      min = { '2-col': 2, '3-col': 3, '3-col-split': 4, '4-col': 4 }[layout]
      if (layout === '3-col-split') max = 4
    }
    if (d.bannerIds.length < min || d.bannerIds.length > max) errors.banner_ids = min === max ? `Choose exactly ${min} banners.` : `Choose ${min} to ${max} banners.`
  }
  if (info.type === 'rich_text' && !(d.config as SectionConfigs['rich_text']).body_html) errors['config.body_html'] = 'Write some text.'
  if (info.type === 'features_strip' || info.type === 'testimonials') {
    const items = (d.config as SectionConfigs['features_strip'] | SectionConfigs['testimonials']).items
    if (items.length === 0) errors['config.items'] = 'Add at least one.'
    items.forEach((item, i) => {
      if ('title' in item && !item.title.trim()) errors[`config.items.${i}.title`] = 'Enter a title.'
      if ('quote' in item && !item.quote.trim()) errors[`config.items.${i}.quote`] = 'Enter the quote.'
      if ('name' in item && !item.name.trim()) errors[`config.items.${i}.name`] = 'Enter a name.'
    })
  }
  if (d.startsAt && d.endsAt && d.endsAt <= d.startsAt) errors.ends_at = 'The end must be after the start.'
  return errors
}

/** Add or edit one homepage section; mounted inside DialogContent. */
export function SectionEditor({ info, section, onDone }: { info: SectionTypeInfo; section?: HomepageSection; onDone: () => void }) {
  const save = useSaveSectionMutation()
  const [draft, setDraft] = useState<Draft>(() => ({
    title: section?.title ?? '',
    subtitle: section?.subtitle ?? '',
    config: section?.config ?? structuredClone(info.defaults),
    bannerIds: section?.banner_ids ?? [],
    isEnabled: section?.is_enabled ?? true,
    startsAt: toLocalInput(section?.starts_at ?? null),
    endsAt: toLocalInput(section?.ends_at ?? null),
  }))
  const [errors, setErrors] = useState<Errors>({})
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }))

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const local = validate(info, draft)
    if (Object.keys(local).length > 0) return setErrors(local)
    setErrors({})

    const input: Partial<SectionInput> = {
      title: draft.title.trim() || null,
      subtitle: draft.subtitle.trim() || null,
      config: draft.config,
      is_enabled: draft.isEnabled,
      starts_at: fromLocalInput(draft.startsAt),
      ends_at: fromLocalInput(draft.endsAt),
      ...(info.items ? { banner_ids: draft.bannerIds } : {}),
      ...(section ? {} : { type: info.type }),
    }
    save.mutate(
      { id: section?.id, input },
      {
        onSuccess: () => {
          toast.success(section ? 'Section saved.' : 'Section added at the end of the homepage.')
          onDone()
        },
        onError: (error) => setErrors(error instanceof ApiError && error.code !== 'VALIDATION_FAILED' ? { form: error.message } : fieldErrorMap(error)),
      },
    )
  }

  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-5">
      <DialogHeader>
        <DialogTitle>{section ? `Edit ${info.label.toLowerCase()}` : `New ${info.label.toLowerCase()}`}</DialogTitle>
        <DialogDescription>{info.description}</DialogDescription>
      </DialogHeader>

      {info.type !== 'hero_slider' && (
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Title" error={errors.title} hint="Optional heading above the section.">
            <Input maxLength={120} value={draft.title} onChange={(e) => set({ title: e.target.value })} />
          </FormField>
          <FormField label="Subtitle" error={errors.subtitle}>
            <Input maxLength={255} value={draft.subtitle} onChange={(e) => set({ subtitle: e.target.value })} />
          </FormField>
        </div>
      )}

      {info.banner_placement && info.items && (
        <BannerChooser
          placement={info.banner_placement}
          value={draft.bannerIds}
          onChange={(bannerIds) => set({ bannerIds })}
          limits={info.type === 'banner_grid' && (draft.config as SectionConfigs['banner_grid']).layout === '3-col-split' ? { min: 4, max: 4 } : info.items}
          error={errors.banner_ids}
        />
      )}

      <ConfigFields info={info} config={draft.config} onChange={(config) => set({ config })} errors={errors} />

      <div className="grid gap-4 rounded-md bg-muted/50 p-3 sm:grid-cols-3">
        <div className="flex items-center gap-2">
          <Switch id="section-enabled" checked={draft.isEnabled} onCheckedChange={(isEnabled) => set({ isEnabled })} />
          <Label htmlFor="section-enabled">Shown on the homepage</Label>
        </div>
        <FormField label="Show from" hint="Optional.">
          <Input type="datetime-local" value={draft.startsAt} onChange={(e) => set({ startsAt: e.target.value })} />
        </FormField>
        <FormField label="Show until" error={errors.ends_at} hint="Optional.">
          <Input type="datetime-local" value={draft.endsAt} onChange={(e) => set({ endsAt: e.target.value })} />
        </FormField>
      </div>

      {errors.form && <p role="alert" className="text-sm text-destructive">{errors.form}</p>}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>Cancel</Button>
        <Button type="submit" disabled={save.isPending}>
          {save.isPending && <Loader2Icon className="animate-spin" data-icon="inline-start" />} {section ? 'Save section' : 'Add section'}
        </Button>
      </DialogFooter>
    </form>
  )
}
