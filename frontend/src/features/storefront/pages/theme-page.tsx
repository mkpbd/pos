import { useCallback, useEffect, useState } from 'react'
import { Controller, useForm, useWatch, type FieldErrors, type Path } from 'react-hook-form'
import { useBlocker } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { zodResolver } from '@hookform/resolvers/zod'
import { CheckIcon, ExternalLinkIcon, HistoryIcon, Loader2Icon, UploadCloudIcon, XIcon } from 'lucide-react'
import { toast } from 'sonner'
// The storefront's font faces, so the preset previews and font choices show in their real typeface.
import '@fontsource-variable/baloo-2'
import '@fontsource-variable/jost'
import '@fontsource-variable/playfair-display'
import '@fontsource/poppins/600.css'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { FormField } from '@/components/common/form-field'
import { ErrorState, LoadingState } from '@/components/common/state-views'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { useCan } from '@/features/auth/use-auth'
import { useMediaLookup } from '@/features/media/api'
import { MediaField, MediaPicker, MediaThumb } from '@/features/media/components/media-picker'
import {
  fetchThemeDraft,
  LAYOUT_OPTIONS,
  MAX_PAYMENT_LOGOS,
  SOCIAL_NETWORKS,
  storefrontKeys,
  type LayoutVariantKey,
  type SocialNetwork,
  type ThemeDraft,
  type ThemePreset,
  type ThemePresetKey,
  type ThemeSettings,
  type ThemeVersion,
  useApplyThemePresetMutation,
  useDiscardThemeDraftMutation,
  usePublishThemeMutation,
  useRestoreThemeVersionMutation,
  useSaveCustomCssMutation,
  useSaveThemeDraftMutation,
  useThemeDraftQuery,
  useThemePresetsQuery,
} from '@/features/storefront/api'
import { ColorField } from '@/features/storefront/components/color-field'
import { StorefrontHeader } from '@/features/storefront/components/storefront-header'
import { contrastRatio, meetsAA } from '@/features/storefront/contrast'
import { GlobalStylesPanel } from '@/features/storefront/theme/global-styles'
import { ThemeConflictDialog, ThemePublishDialog, ThemeVersionsDialog } from '@/features/storefront/theme/theme-dialogs'
import { FONT_FAMILIES, FONT_LABELS } from '@/features/storefront/theme/theme-options'
import { ANNOUNCEMENT_TEXT_MAX, THEME_FIELDS, themeSchema, toDocument, toFormValues, type ThemeFormValues } from '@/features/storefront/theme-form'
import { BanglaTranslations } from '@/features/translations/components/bangla-translations'
import { rhfBnErrors, type TranslationsMap } from '@/features/translations/translations'
import { ApiError } from '@/lib/api/client'

/** Without a store domain (no `preview_url`): the store's home page on this host, showing the saved draft theme to staff. */
const DRAFT_PREVIEW_URL = '/?preview=draft'

const LAYOUT_FIELDS: { key: LayoutVariantKey; label: string; hint: string; options: Record<string, string> }[] = [
  { key: 'top_bar', label: 'Top bar', hint: 'Above the header on wide screens.', options: { none: 'Announcement bar', ticker: 'Scrolling announcement', utility: 'Contact & account links' } },
  { key: 'header_style', label: 'Header', hint: 'Phones always get the compact header.', options: { standard: 'Standard — search beside the logo', centered: 'Centered brand, search icon', commerce: 'Shop — wide search, cart total' } },
  { key: 'hero_style', label: 'Hero slider', hint: 'How the hero slider section is shown.', options: { full: 'Full-width slides', tiles: 'Up to three editorial tiles', sale: 'Sale slides — bold uppercase' } },
  { key: 'card_style', label: 'Product cards', hint: 'Grids and carousels; list view stays standard.', options: { standard: 'Standard', minimal: 'Minimal — image-led, no buttons', commerce: 'Shop — hover actions, ratings' } },
  { key: 'footer_style', label: 'Footer', hint: 'Product lists use your best sellers, newest and top-rated products.', options: { columns: 'Link columns', showcase: 'Brand & product showcase', widgets: 'Widgets — posts, products, newsletter' } },
  { key: 'heading_case', label: 'Section headings', hint: 'Letter case of section and banner headings.', options: { normal: 'As written', lowercase: 'lowercase', uppercase: 'UPPERCASE' } },
]
const SOCIAL_LABELS: Record<SocialNetwork, string> = { facebook: 'Facebook', instagram: 'Instagram', youtube: 'YouTube', tiktok: 'TikTok', x: 'X (Twitter)', linkedin: 'LinkedIn' }

/** The panel's keys of the form: colours, store palette, fonts and type scale, button shape and card radius. */
const GLOBAL_STYLE_KEYS = ['colors', 'palette', 'typography', 'shape'] as const

/** react-hook-form errors of a subtree as `{ "colors.primary": message }`. */
function flattenErrors(errors: FieldErrors | undefined, prefix: string, out: Record<string, string> = {}): Record<string, string> {
  if (!errors) return out
  for (const [key, value] of Object.entries(errors)) {
    if (!value || typeof value !== 'object') continue
    const path = `${prefix}.${key}`
    if ('message' in value && typeof value.message === 'string') out[path] = value.message
    else flattenErrors(value as FieldErrors, path, out)
  }
  return out
}

function PaymentLogos({ value, onChange, disabled }: { value: string[]; onChange: (ids: string[]) => void; disabled: boolean }) {
  const [open, setOpen] = useState(false)
  const { byId } = useMediaLookup(value)

  return (
    <div className="flex flex-wrap items-center gap-2">
      {value.map((id) => (
        <span key={id} className="relative">
          <MediaThumb id={id} byId={byId} className="size-12" />
          {!disabled && (
            <button type="button" aria-label="Remove logo" onClick={() => onChange(value.filter((x) => x !== id))} className="absolute -top-1.5 -right-1.5 rounded-full border bg-background p-0.5">
              <XIcon className="size-3" />
            </button>
          )}
        </span>
      ))}
      {!disabled && (
        <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
          {value.length ? 'Change logos' : 'Choose logos'}
        </Button>
      )}
      <MediaPicker open={open} onOpenChange={setOpen} title="Payment logos" multiple max={MAX_PAYMENT_LOGOS} selected={value} onConfirm={onChange} />
    </div>
  )
}

function AnnouncementContrast({ foreground, background }: { foreground: string; background: string }) {
  const ratio = contrastRatio(foreground, background)
  const pass = meetsAA(ratio)
  return (
    <p className="flex items-center gap-2 text-sm sm:col-span-2" aria-label="Announcement contrast">
      <span className="inline-flex size-6 items-center justify-center rounded border text-xs font-semibold" style={{ color: foreground, background }} aria-hidden>
        Aa
      </span>
      Readability {ratio ? `${ratio.toFixed(1)}:1` : '—'}
      <Badge variant={pass ? 'success' : 'warning'}>{pass ? 'AA pass' : 'Below AA'}</Badge>
    </p>
  )
}

type Props = { draft: ThemeDraft; canManage: boolean; canPublish: boolean }

/**
 * The theme editor (B3: draft → publish). Edits stay in the form until "Save draft"; the store
 * changes only on "Publish". A stale save (409) asks whose version to keep.
 */
function ThemeEditor({ draft, canManage, canPublish }: Props) {
  const form = useForm<ThemeFormValues>({ resolver: zodResolver(themeSchema), defaultValues: toFormValues(draft.settings) })
  const { errors, isDirty } = form.formState
  const { control, register } = form
  const queryClient = useQueryClient()
  const save = useSaveThemeDraftMutation()
  const publish = usePublishThemeMutation()
  const discard = useDiscardThemeDraftMutation()
  const restore = useRestoreThemeVersionMutation()
  const [conflict, setConflict] = useState<ThemeFormValues | null>(null)
  const [resolving, setResolving] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [discarding, setDiscarding] = useState(false)
  const [history, setHistory] = useState(false)
  useEffect(() => {
    form.reset(toFormValues(draft.settings))
  }, [draft.settings, form])

  const applyServerErrors = (error: unknown): boolean => {
    if (!(error instanceof ApiError) || error.code !== 'VALIDATION_FAILED') return false
    let mapped = false
    for (const [key, messages] of Object.entries(error.fieldErrors)) {
      const path = key.replace(/^settings\./, '')
      if ((THEME_FIELDS as readonly string[]).includes(path.split('.')[0] ?? '')) {
        form.setError(path as Path<ThemeFormValues>, { type: 'server', message: messages[0] })
        mapped = true
      }
    }
    if (mapped) toast.error('Please correct the highlighted fields.')
    return mapped
  }

  /** Saves the values as the draft; false when it did not (conflict, invalid, network). */
  const saveValues = async (values: ThemeFormValues, rev = draft.draft_revision): Promise<boolean> => {
    try {
      await save.mutateAsync({ revision: rev, settings: toDocument(values, draft.settings.announcement.translations as TranslationsMap) })
      return true
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) setConflict(values)
      else if (!applyServerErrors(error)) toast.error(error instanceof Error ? error.message : 'Could not save the draft.')
      return false
    }
  }

  /** Validates and saves when there are unsaved changes; true when the draft is saved. */
  const saveIfDirty = async (): Promise<boolean> => {
    if (!form.formState.isDirty) return true
    let values: ThemeFormValues | null = null
    await form.handleSubmit(
      (v) => {
        values = v
      },
      () => toast.error('Please correct the highlighted fields.'),
    )()
    return values ? saveValues(values) : false
  }

  const onSubmit = form.handleSubmit(
    async (values) => {
      if (await saveValues(values)) toast.success('Draft saved. Publish to show it on your store.')
    },
    () => toast.error('Please correct the highlighted fields.'),
  )

  const onConflict = async (choice: 'theirs' | 'mine') => {
    const mine = conflict
    setResolving(true)
    try {
      const latest = await fetchThemeDraft()
      if (choice === 'theirs' || !mine) {
        queryClient.setQueryData(storefrontKeys.themeDraft, latest)
        form.reset(toFormValues(latest.settings))
        setConflict(null)
        toast.success('Loaded the latest draft.')
      } else {
        setConflict(null)
        if (await saveValues(mine, latest.draft_revision)) toast.success('Draft saved. Publish to show it on your store.')
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not load the latest draft.')
    } finally {
      setResolving(false)
    }
  }

  const onPreview = async () => {
    // Open the tab now (popup blockers allow it during the click), point it at the preview once saved.
    const tab = window.open('', '_blank')
    if (!(await saveIfDirty())) {
      tab?.close()
      return
    }
    const url = queryClient.getQueryData<ThemeDraft>(storefrontKeys.themeDraft)?.preview_url ?? draft.preview_url ?? DRAFT_PREVIEW_URL
    if (tab) tab.location.href = url
    else window.open(url, '_blank', 'noopener')
  }

  const onPublish = async (note: string | null) => {
    if (!(await saveIfDirty())) return
    try {
      await publish.mutateAsync(note)
      setPublishing(false)
      toast.success('Theme published. Your store shows it now.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not publish the theme.')
    }
  }

  const onDiscard = async () => {
    if (!draft.has_unpublished_changes) {
      form.reset(toFormValues(draft.settings))
      setDiscarding(false)
      return
    }
    try {
      const result = await discard.mutateAsync()
      form.reset(toFormValues(result.settings))
      setDiscarding(false)
      toast.success('Draft discarded. The theme is back to the live version.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not discard the draft.')
    }
  }

  const onRestore = async (version: ThemeVersion) => {
    try {
      const result = await restore.mutateAsync(version.id)
      form.reset(toFormValues(result.settings))
      setHistory(false)
      toast.success(`Version ${version.number} restored to your draft. Publish to show it on your store.`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not restore the version.')
    }
  }

  // Unsaved guard: leaving the page (in the app or the browser) with unsaved edits asks first.
  useEffect(() => {
    if (!isDirty) return
    const onBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [isDirty])
  const blocker = useBlocker(useCallback(({ currentLocation, nextLocation }) => isDirty && currentLocation.pathname !== nextLocation.pathname, [isDirty]))

  const [colors, palette, typography, shape, announcementEnabled, announcementText, announcementForeground, announcementBackground] = useWatch({
    control,
    name: ['colors', 'palette', 'typography', 'shape', 'announcement.enabled', 'announcement.text', 'announcement.foreground', 'announcement.background'],
  })
  const panelSettings: ThemeSettings = { ...draft.settings, colors, palette, typography, shape }
  const panelErrors = Object.assign({}, ...GLOBAL_STYLE_KEYS.map((key) => flattenErrors(errors[key] as FieldErrors | undefined, key)), errors.palette?.message ? { palette: errors.palette.message } : {}) as Record<string, string>

  const onPanelChange = (next: ThemeSettings) => {
    const current: Record<string, unknown> = { colors, palette, typography, shape }
    for (const key of GLOBAL_STYLE_KEYS) {
      if (next[key] !== current[key]) form.setValue(key, next[key] as never, { shouldDirty: true, shouldValidate: form.formState.isSubmitted })
    }
  }

  const busy = save.isPending || publish.isPending || discard.isPending || resolving
  const status = isDirty ? 'unsaved' : draft.has_unpublished_changes ? 'draft' : 'live'

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/40 px-4 py-3 text-sm" role="status" aria-label="Theme status" data-testid="theme-status">
        {status === 'unsaved' ? <Badge variant="warning">Unsaved changes</Badge> : status === 'draft' ? <Badge variant="secondary">Draft — not live yet</Badge> : <Badge variant="success">Live</Badge>}
        <span className="text-muted-foreground">
          {status === 'live'
            ? 'Your store shows this theme.'
            : 'You are editing a draft. Shoppers keep seeing the live theme until you publish.'}
          {draft.published && ` Live: version ${draft.published.number}.`}
        </span>
      </div>

      <fieldset disabled={!canManage} className="flex flex-col gap-6">
        <GlobalStylesPanel settings={panelSettings} onChange={onPanelChange} disabled={!canManage} errors={panelErrors} />

        <div className="grid gap-6 xl:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Branding</CardTitle>
              <CardDescription>Logo in the header and footer; favicon in browser tabs.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label>Logo</Label>
                <Controller control={control} name="logo_media_id" render={({ field }) => <MediaField value={field.value} onChange={field.onChange} title="Choose the logo" disabled={!canManage} />} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Favicon</Label>
                <Controller control={control} name="favicon_media_id" render={({ field }) => <MediaField value={field.value} onChange={field.onChange} title="Choose the favicon" disabled={!canManage} />} />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Page width</CardTitle>
              <CardDescription>How wide the content gets on large screens, and whether the header follows while scrolling.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <FormField label="Content width (px)" error={errors.layout?.container_width?.message} hint="960–1440">
                <Input type="number" min={960} max={1440} step={10} {...register('layout.container_width', { valueAsNumber: true })} />
              </FormField>
              <Controller control={control} name="layout.sticky_header" render={({ field }) => (
                <div className="flex items-center gap-2 self-end pb-2">
                  <Switch id="sticky-header" checked={field.value} onCheckedChange={field.onChange} disabled={!canManage} />
                  <Label htmlFor="sticky-header">Header stays visible while scrolling</Label>
                </div>
              )} />
            </CardContent>
          </Card>

          <Card className="xl:col-span-2">
            <CardHeader>
              <CardTitle>Layout</CardTitle>
              <CardDescription>The page structure of the store. A preset sets these for you; each one can be changed on its own.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {LAYOUT_FIELDS.map(({ key, label, hint, options }) => (
                <Controller key={key} control={control} name={`layout.${key}`} render={({ field }) => (
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor={`layout-${key}`}>{label}</Label>
                    <Select value={field.value} onValueChange={field.onChange} disabled={!canManage}>
                      <SelectTrigger id={`layout-${key}`} className="w-full" aria-describedby={`layout-${key}-hint`}><SelectValue /></SelectTrigger>
                      <SelectContent>{(LAYOUT_OPTIONS[key] as readonly string[]).map((o) => <SelectItem key={o} value={o}>{options[o]}</SelectItem>)}</SelectContent>
                    </Select>
                    <p id={`layout-${key}-hint`} className={errors.layout?.[key] ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'}>{errors.layout?.[key]?.message ?? hint}</p>
                  </div>
                )} />
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Announcement bar</CardTitle>
              <CardDescription>A one-line message above the header, optionally scheduled.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <Controller control={control} name="announcement.enabled" render={({ field }) => (
                <div className="flex items-center gap-2 sm:col-span-2">
                  <Switch id="announcement-enabled" checked={field.value} onCheckedChange={field.onChange} disabled={!canManage} />
                  <Label htmlFor="announcement-enabled">Show the announcement</Label>
                </div>
              )} />
              <FormField label="Text" error={errors.announcement?.text?.message} className="sm:col-span-2" hint={announcementEnabled ? undefined : 'Saved but hidden while switched off.'}>
                <Input maxLength={ANNOUNCEMENT_TEXT_MAX} {...register('announcement.text')} />
              </FormField>
              <Controller control={control} name="announcement.translations.bn" render={({ field }) => (
                <BanglaTranslations
                  className="sm:col-span-2"
                  fields={[{ name: 'text', label: 'Announcement text', base: announcementText, max: ANNOUNCEMENT_TEXT_MAX }]}
                  value={field.value}
                  onChange={field.onChange}
                  errors={rhfBnErrors(errors.announcement?.translations)}
                  disabled={!canManage}
                />
              )} />
              <FormField label="Link (optional)" error={errors.announcement?.link?.message} hint="/sale or https://…" className="sm:col-span-2">
                <Input {...register('announcement.link')} />
              </FormField>
              <Controller control={control} name="announcement.background" render={({ field }) => <ColorField label="Background" value={field.value} onChange={field.onChange} error={errors.announcement?.background?.message} disabled={!canManage} />} />
              <Controller control={control} name="announcement.foreground" render={({ field }) => <ColorField label="Text colour" value={field.value} onChange={field.onChange} error={errors.announcement?.foreground?.message} disabled={!canManage} />} />
              <AnnouncementContrast foreground={announcementForeground} background={announcementBackground} />
              <FormField label="Show from (your time)" error={errors.announcement?.starts_at?.message}>
                <Input type="datetime-local" {...register('announcement.starts_at')} />
              </FormField>
              <FormField label="Show until (your time)" error={errors.announcement?.ends_at?.message}>
                <Input type="datetime-local" {...register('announcement.ends_at')} />
              </FormField>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Footer</CardTitle>
              <CardDescription>About text, contact details, social links and accepted payment methods.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <FormField label="About" error={errors.footer?.about?.message} className="sm:col-span-2"><Textarea rows={3} maxLength={500} {...register('footer.about')} /></FormField>
              <FormField label="Copyright line" error={errors.footer?.copyright?.message} className="sm:col-span-2"><Input maxLength={200} {...register('footer.copyright')} /></FormField>
              <FormField label="Contact e-mail" error={errors.footer?.contact?.email?.message}><Input type="email" {...register('footer.contact.email')} /></FormField>
              <FormField label="Contact phone" error={errors.footer?.contact?.phone?.message}><Input type="tel" {...register('footer.contact.phone')} /></FormField>
              <FormField label="Address" error={errors.footer?.contact?.address?.message} className="sm:col-span-2"><Input {...register('footer.contact.address')} /></FormField>
              {SOCIAL_NETWORKS.map((n) => (
                <FormField key={n} label={SOCIAL_LABELS[n]} error={errors.footer?.social?.[n]?.message}>
                  <Input type="url" placeholder="https://" {...register(`footer.social.${n}`)} />
                </FormField>
              ))}
              <div className="flex flex-col gap-1.5 sm:col-span-2">
                <Label>Payment logos</Label>
                <Controller control={control} name="footer.payment_logo_media_ids" render={({ field }) => <PaymentLogos value={field.value} onChange={field.onChange} disabled={!canManage} />} />
                {errors.footer?.payment_logo_media_ids?.message && <p className="text-sm text-destructive">{errors.footer.payment_logo_media_ids.message}</p>}
              </div>
            </CardContent>
          </Card>
        </div>
      </fieldset>

      <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-end gap-2 border-t bg-background/95 py-3 backdrop-blur" data-testid="theme-actions">
        <span className="mr-auto text-sm text-muted-foreground" aria-live="polite">
          {isDirty ? 'Unsaved changes' : draft.has_unpublished_changes ? 'Draft saved — not published yet' : 'No unpublished changes'}
        </span>
        <Button type="button" variant="ghost" onClick={() => setHistory(true)}>
          <HistoryIcon data-icon="inline-start" /> History
        </Button>
        {canManage && (
          <Button type="button" variant="outline" disabled={busy || !(isDirty || draft.has_unpublished_changes)} onClick={() => setDiscarding(true)}>
            Discard
          </Button>
        )}
        <Button type="button" variant="outline" disabled={busy} onClick={() => void onPreview()}>
          <ExternalLinkIcon data-icon="inline-start" /> Preview
        </Button>
        {canManage && (
          <Button type="submit" variant={canPublish ? 'outline' : 'default'} disabled={busy || !isDirty}>
            {save.isPending && <Loader2Icon data-icon="inline-start" className="animate-spin" />}
            Save draft
          </Button>
        )}
        {canManage && canPublish && (
          <Button type="button" disabled={busy || !(isDirty || draft.has_unpublished_changes)} onClick={() => setPublishing(true)}>
            <UploadCloudIcon data-icon="inline-start" /> Publish
          </Button>
        )}
      </div>

      <ThemePublishDialog open={publishing} onOpenChange={setPublishing} pending={busy} unsaved={isDirty} onPublish={(note) => void onPublish(note)} />
      <ThemeConflictDialog open={conflict !== null} pending={resolving} onChoose={(choice) => void onConflict(choice)} />
      <ThemeVersionsDialog open={history} onOpenChange={setHistory} liveNumber={draft.published?.number ?? null} canRestore={canManage} onRestore={onRestore} />
      <ConfirmDialog
        open={discarding}
        onOpenChange={(open) => !discard.isPending && setDiscarding(open)}
        title="Discard the draft?"
        description={draft.has_unpublished_changes ? 'Every change since the last publish is thrown away (including unsaved ones); the theme goes back to what your store shows now.' : 'Your unsaved changes are thrown away.'}
        confirmLabel="Discard"
        pending={discard.isPending}
        onConfirm={() => void onDiscard()}
      />
      <ConfirmDialog
        open={blocker.state === 'blocked'}
        onOpenChange={(open) => !open && blocker.state === 'blocked' && blocker.reset()}
        title="Leave without saving?"
        description="Your theme changes are not saved yet. If you leave now, they are lost."
        confirmLabel="Leave anyway"
        onConfirm={() => blocker.state === 'blocked' && blocker.proceed()}
      />
    </form>
  )
}

const PREVIEW_SWATCHES = ['primary', 'accent', 'highlight', 'sale', 'heading', 'canvas'] as const

/** A preset as a selectable card: a miniature of its colours, heading font and buttons. */
function PresetOption({ preset, checked, current, disabled, onSelect }: { preset: ThemePreset; checked: boolean; current: boolean; disabled: boolean; onSelect: () => void }) {
  const { colors, typography, shape } = preset.theme
  const descriptionId = `preset-${preset.key}-description`
  const buttonRadius = shape.button_style === 'pill' ? '9999px' : shape.button_style === 'rounded' ? '0.375rem' : '0'

  return (
    <label
      className="group relative flex cursor-pointer flex-col overflow-hidden rounded-lg border bg-card transition hover:border-primary/60 has-[:checked]:border-primary has-[:checked]:ring-2 has-[:checked]:ring-primary/30 has-[:disabled]:cursor-default has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring"
      data-testid={`preset-${preset.key}`}
    >
      <input type="radio" name="theme-preset" value={preset.key} checked={checked} onChange={onSelect} disabled={disabled} aria-label={preset.name} aria-describedby={descriptionId} className="sr-only" />
      <div aria-hidden className="flex h-32 flex-col justify-between p-4" style={{ background: colors.canvas, borderBottom: `4px solid ${colors.primary}` }}>
        <div className="flex items-start justify-between gap-2">
          <span className="text-4xl leading-none" style={{ fontFamily: FONT_FAMILIES[typography.heading_font], color: colors.heading, fontWeight: 600 }}>
            Aa
          </span>
          <span className="px-3 py-1 text-[0.65rem] font-semibold" style={{ background: colors.button ?? colors.primary, color: colors.button_foreground ?? colors.primary_foreground, borderRadius: buttonRadius, fontFamily: FONT_FAMILIES[typography.body_font] }}>
            Shop
          </span>
        </div>
        <div className="flex gap-1.5">
          {PREVIEW_SWATCHES.map((c) => (
            <span key={c} className="size-5 rounded-full border border-black/10" style={{ background: colors[c] }} />
          ))}
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-1 p-4">
        <span className="flex items-center justify-between gap-2 font-medium">
          {preset.name}
          {current && <Badge variant="secondary">Current</Badge>}
        </span>
        <span id={descriptionId} className="text-sm text-muted-foreground">{preset.description}</span>
        <span className="mt-1 text-xs text-muted-foreground">
          {FONT_LABELS[typography.heading_font]?.split(' (')[0]} · {FONT_LABELS[typography.body_font]?.split(' (')[0]}
        </span>
      </div>
      {checked && (
        <span aria-hidden className="absolute top-2 right-2 grid size-6 place-items-center rounded-full bg-primary text-primary-foreground">
          <CheckIcon className="size-4" />
        </span>
      )}
    </label>
  )
}

/**
 * The preset gallery: choose a complete look and apply it to the draft after a confirmation.
 * Applying replaces colours, fonts, shape and layout; the logo, favicon, announcement and footer
 * content stay. The store changes when the draft is published.
 */
function PresetCard({ draft, canManage }: { draft: ThemeDraft; canManage: boolean }) {
  const presets = useThemePresetsQuery()
  const apply = useApplyThemePresetMutation()
  const current: ThemePresetKey = draft.settings.preset ?? 'default'
  const [selected, setSelected] = useState<ThemePresetKey>(current)
  const [confirming, setConfirming] = useState(false)
  const chosen = presets.data?.find((p) => p.key === selected)

  const onConfirm = () => {
    if (!chosen) return
    apply.mutate(chosen.key, {
      onSuccess: () => {
        setConfirming(false)
        toast.success(`${chosen.name} preset applied to your draft. Publish to show it on your store.`)
      },
      onError: (e) => {
        setConfirming(false)
        toast.error(e.message)
      },
    })
  }

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1.5">
          <CardTitle>Preset</CardTitle>
          <CardDescription>Start from a complete look: colours, fonts, buttons and layout. It applies to your draft — publish to go live. Everything stays editable below.</CardDescription>
        </div>
        <Button asChild variant="outline">
          <a href="/?preview=1" target="_blank" rel="noreferrer"><ExternalLinkIcon data-icon="inline-start" /> View store</a>
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {presets.isPending ? (
          <LoadingState rows={2} label="Loading presets" />
        ) : presets.error ? (
          <ErrorState error={presets.error} onRetry={() => presets.refetch()} />
        ) : (
          <div role="radiogroup" aria-label="Theme presets" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {presets.data.map((preset) => (
              <PresetOption key={preset.key} preset={preset} checked={selected === preset.key} current={current === preset.key} disabled={!canManage || apply.isPending} onSelect={() => setSelected(preset.key)} />
            ))}
          </div>
        )}
        {canManage && presets.data && (
          <div className="flex flex-wrap items-center justify-end gap-3">
            {apply.isError && <p role="alert" className="text-sm text-destructive">{apply.error.message}</p>}
            <Button type="button" disabled={!chosen || apply.isPending} onClick={() => setConfirming(true)}>
              {apply.isPending && <Loader2Icon data-icon="inline-start" className="animate-spin" />}
              Apply preset
            </Button>
          </div>
        )}
      </CardContent>
      <ConfirmDialog
        open={confirming}
        onOpenChange={(open) => !apply.isPending && setConfirming(open)}
        title={`Apply the ${chosen?.name ?? ''} preset?`}
        description="Replaces colours, fonts and layout in your draft; keeps your logo, announcement and footer text. Unsaved changes in the theme form are discarded. Applies to your draft — publish to go live."
        confirmLabel="Apply preset"
        destructive={false}
        pending={apply.isPending}
        onConfirm={onConfirm}
      />
    </Card>
  )
}

function CustomCssCard({ draft }: { draft: ThemeDraft }) {
  const save = useSaveCustomCssMutation()
  const [css, setCss] = useState(draft.custom_css ?? '')
  const [error, setError] = useState<string | undefined>()

  return (
    <Card>
      <CardHeader>
        <CardTitle>Custom CSS</CardTitle>
        <CardDescription>
          Advanced tweaks added to every storefront page. Saved straight to your live store — not part of the draft. Not allowed: &lt;, @import, expression(), backslash escapes, and url() outside /storage/.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <FormField label="CSS" error={error} hint={`${new TextEncoder().encode(css).length.toLocaleString()} / 20,000 bytes`}>
          <Textarea rows={8} spellCheck={false} className="font-mono text-xs" value={css} onChange={(e) => setCss(e.target.value)} />
        </FormField>
        <Button
          type="button"
          className="self-start"
          disabled={save.isPending || css === (draft.custom_css ?? '')}
          onClick={() => {
            setError(undefined)
            save.mutate(css.trim() ? css : null, {
              onSuccess: () => toast.success('Custom CSS saved to your live store.'),
              onError: (e) => setError(e.message),
            })
          }}
        >
          {save.isPending && <Loader2Icon data-icon="inline-start" className="animate-spin" />}
          Save CSS
        </Button>
      </CardContent>
    </Card>
  )
}

export function ThemePage() {
  const can = useCan()
  const draft = useThemeDraftQuery()

  return (
    <div className="flex flex-col gap-6">
      <StorefrontHeader />
      {draft.isPending ? (
        <LoadingState rows={6} label="Loading theme" />
      ) : draft.error ? (
        <ErrorState error={draft.error} onRetry={() => draft.refetch()} />
      ) : (
        <>
          <PresetCard draft={draft.data} canManage={can('storefront.manage')} />
          <ThemeEditor draft={draft.data} canManage={can('storefront.manage')} canPublish={can('storefront.publish')} />
          {can('storefront.custom_css') && <CustomCssCard key={draft.data.custom_css ?? ''} draft={draft.data} />}
        </>
      )}
    </div>
  )
}
