import { useEffect, useState } from 'react'
import { Controller, useForm, useWatch, type Control } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Loader2Icon, XIcon } from 'lucide-react'
import { toast } from 'sonner'
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
import { MAX_PAYMENT_LOGOS, SOCIAL_NETWORKS, THEME_COLORS, type SocialNetwork, useSaveCustomCssMutation, useSaveThemeMutation, useThemeQuery, type ThemeResponse } from '@/features/storefront/api'
import { ColorField } from '@/features/storefront/components/color-field'
import { StorefrontHeader } from '@/features/storefront/components/storefront-header'
import { contrastRatio, meetsAA } from '@/features/storefront/contrast'
import { ANNOUNCEMENT_TEXT_MAX, COLOR_LABELS, contrastPairs, THEME_FIELDS, themeSchema, toDocument, toFormValues, type ThemeFormValues } from '@/features/storefront/theme-form'
import { BanglaTranslations } from '@/features/translations/components/bangla-translations'
import { rhfBnErrors, type TranslationsMap } from '@/features/translations/translations'
import { handleFormError } from '@/lib/forms'

const FONT_LABELS: Record<string, string> = { baloo: 'Baloo (rounded, playful)', poppins: 'Poppins (geometric)', system: 'System font' }
const BUTTON_LABELS: Record<string, string> = { pill: 'Pill', rounded: 'Rounded', square: 'Square' }
const SOCIAL_LABELS: Record<SocialNetwork, string> = { facebook: 'Facebook', instagram: 'Instagram', youtube: 'YouTube', tiktok: 'TikTok', x: 'X (Twitter)', linkedin: 'LinkedIn' }

function ContrastChecks({ control }: { control: Control<ThemeFormValues> }) {
  const values = useWatch({ control }) as ThemeFormValues

  return (
    <ul className="flex flex-col gap-1.5 text-sm" aria-label="Contrast checks">
      {contrastPairs(values).map((pair) => {
        const ratio = contrastRatio(pair.foreground, pair.background)
        const pass = meetsAA(ratio)
        return (
          <li key={pair.label} className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2">
              <span className="inline-flex size-6 items-center justify-center rounded border text-xs font-semibold" style={{ color: pair.foreground, background: pair.background }} aria-hidden>
                Aa
              </span>
              {pair.label}
            </span>
            <span className="flex items-center gap-2">
              <span className="tabular-nums text-muted-foreground">{ratio ? `${ratio.toFixed(1)}:1` : '—'}</span>
              <Badge variant={pass ? 'success' : 'warning'}>{pass ? 'AA pass' : 'Below AA'}</Badge>
            </span>
          </li>
        )
      })}
    </ul>
  )
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

function ThemeForm({ theme, canManage }: { theme: ThemeResponse; canManage: boolean }) {
  const save = useSaveThemeMutation()
  const form = useForm<ThemeFormValues>({ resolver: zodResolver(themeSchema), defaultValues: toFormValues(theme.settings) })
  const { errors, isDirty } = form.formState
  const { control, register } = form

  useEffect(() => {
    form.reset(toFormValues(theme.settings))
  }, [theme.settings, form])

  const onSubmit = form.handleSubmit(
    (v) => save.mutate(toDocument(v, theme.settings.announcement.translations as TranslationsMap), { onSuccess: () => toast.success('Theme saved.'), onError: (e) => handleFormError(e, form.setError, THEME_FIELDS, { nested: true }) }),
    () => toast.error('Please correct the highlighted fields.'),
  )

  const [announcementEnabled, announcementText] = useWatch({ control, name: ['announcement.enabled', 'announcement.text'] })

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-6">
      <fieldset disabled={!canManage} className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Colours</CardTitle>
            <CardDescription>Applied to buttons, badges, links and backgrounds across the storefront.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-6">
            <div className="grid gap-4 sm:grid-cols-2">
              {THEME_COLORS.map((c) => (
                <Controller
                  key={c}
                  control={control}
                  name={`colors.${c}`}
                  render={({ field }) => <ColorField label={COLOR_LABELS[c]} value={field.value} onChange={field.onChange} error={errors.colors?.[c]?.message} disabled={!canManage} />}
                />
              ))}
            </div>
            <div className="flex flex-col gap-2">
              <h3 className="text-sm font-medium">Readability (WCAG AA, 4.5:1)</h3>
              <ContrastChecks control={control} />
            </div>
          </CardContent>
        </Card>

        <div className="flex flex-col gap-6">
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
              <CardTitle>Typography & layout</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <FormField label="Heading font" error={errors.typography?.heading_font?.message}>
                <Controller control={control} name="typography.heading_font" render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange} disabled={!canManage}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>{['baloo', 'poppins', 'system'].map((f) => <SelectItem key={f} value={f}>{FONT_LABELS[f]}</SelectItem>)}</SelectContent>
                  </Select>
                )} />
              </FormField>
              <FormField label="Body font" error={errors.typography?.body_font?.message}>
                <Controller control={control} name="typography.body_font" render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange} disabled={!canManage}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>{['poppins', 'system'].map((f) => <SelectItem key={f} value={f}>{FONT_LABELS[f]}</SelectItem>)}</SelectContent>
                  </Select>
                )} />
              </FormField>
              <FormField label="Button style" error={errors.shape?.button_style?.message}>
                <Controller control={control} name="shape.button_style" render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange} disabled={!canManage}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>{['pill', 'rounded', 'square'].map((s) => <SelectItem key={s} value={s}>{BUTTON_LABELS[s]}</SelectItem>)}</SelectContent>
                  </Select>
                )} />
              </FormField>
              <FormField label="Card corner radius (px)" error={errors.shape?.card_radius?.message} hint="0–24">
                <Input type="number" min={0} max={24} {...register('shape.card_radius', { valueAsNumber: true })} />
              </FormField>
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
        </div>

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
      </fieldset>

      {canManage && (
        <div className="sticky bottom-0 flex items-center justify-end gap-3 border-t bg-background/95 py-3 backdrop-blur">
          {isDirty && <span className="text-sm text-muted-foreground">Unsaved changes</span>}
          <Button type="button" variant="outline" disabled={!isDirty || save.isPending} onClick={() => form.reset(toFormValues(theme.settings))}>Discard</Button>
          <Button type="submit" disabled={save.isPending}>
            {save.isPending && <Loader2Icon data-icon="inline-start" className="animate-spin" />}
            Save theme
          </Button>
        </div>
      )}
    </form>
  )
}

function CustomCssCard({ theme }: { theme: ThemeResponse }) {
  const save = useSaveCustomCssMutation()
  const [css, setCss] = useState(theme.custom_css ?? '')
  const [error, setError] = useState<string | undefined>()

  return (
    <Card>
      <CardHeader>
        <CardTitle>Custom CSS</CardTitle>
        <CardDescription>
          Advanced tweaks added to every storefront page. Not allowed: &lt;, @import, expression(), backslash escapes, and url() outside /storage/.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <FormField label="CSS" error={error} hint={`${new TextEncoder().encode(css).length.toLocaleString()} / 20,000 bytes`}>
          <Textarea rows={8} spellCheck={false} className="font-mono text-xs" value={css} onChange={(e) => setCss(e.target.value)} />
        </FormField>
        <Button
          type="button"
          className="self-start"
          disabled={save.isPending || css === (theme.custom_css ?? '')}
          onClick={() => {
            setError(undefined)
            save.mutate(css.trim() ? css : null, {
              onSuccess: () => toast.success('Custom CSS saved.'),
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
  const theme = useThemeQuery()

  return (
    <div className="flex flex-col gap-6">
      <StorefrontHeader />
      {theme.isPending ? (
        <LoadingState rows={6} label="Loading theme" />
      ) : theme.error ? (
        <ErrorState error={theme.error} onRetry={() => theme.refetch()} />
      ) : (
        <>
          <ThemeForm theme={theme.data} canManage={can('storefront.manage')} />
          {can('storefront.custom_css') && <CustomCssCard key={theme.data.custom_css ?? ''} theme={theme.data} />}
        </>
      )}
    </div>
  )
}
