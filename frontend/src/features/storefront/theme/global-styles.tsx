import { useId, type ReactNode } from 'react'
import { CheckIcon, PlusIcon, RotateCcwIcon, Trash2Icon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ColorControl, ControlLabel, Swatch } from '@/features/store-builder/controls'
import {
  BODY_FONTS,
  BUTTON_STYLES,
  HEADING_FONTS,
  MAX_PALETTE_COLORS,
  type PaletteEntry,
  type ThemeColor,
  type ThemeRoleColor,
  type ThemeSettings,
  type ThemeTypeScale,
} from '@/features/storefront/api'
import { contrastRatio, meetsAA } from '@/features/storefront/contrast'
import { colorValues, COLOR_LABELS, contrastPairs, effectiveColor, PALETTE_NAME_MAX, typographyValues, type ThemeFormValues } from '@/features/storefront/theme-form'
import { cn } from '@/lib/utils'
import { TYPE_DEFAULTS, TYPE_LIMITS, typeSamples } from '@/storefront/type-scale'
import { applyPalette, BUTTON_LABELS, BUTTON_RADII, FONT_FAMILIES, FONT_LABELS, HEADING_WEIGHTS, paletteMatches, PREDEFINED_PALETTES, withColor } from './theme-options'

type Colors = ThemeFormValues['colors']
type Role = ThemeColor | ThemeRoleColor

export type GlobalStylesPanelProps = {
  /** The theme document; only its colours, palette, typography and shape are edited here. */
  settings: ThemeSettings
  onChange(next: ThemeSettings): void
  disabled?: boolean
  /** Validation messages by path (`colors.primary`, `typography.body_size`, `palette.0.name`). */
  errors?: Record<string, string | undefined>
  /** `page`: each group is a card (the Theme page); `drawer`: stacked groups (the builder's Site styles drawer). */
  variant?: 'page' | 'drawer'
}

/** What each colour role paints, in plain words. */
const ROLE_HELP: Record<Role, string> = {
  primary: 'Your main brand colour: call-to-action buttons, the hero underline, rating stars.',
  primary_foreground: 'Text and icons on the primary colour.',
  accent: 'The second brand colour: add-to-cart and form buttons, the navigation bar, badges and hover colours.',
  accent_foreground: 'Text and icons on the secondary colour.',
  canvas: 'The page background behind everything.',
  surface: 'Cards, panels, the header and menus.',
  text: 'Paragraphs and other body text.',
  heading: 'Headings and titles (and the dark footer of some layouts).',
  button: 'Call-to-action buttons such as “View all” and banner buttons.',
  button_foreground: 'The label on those buttons.',
  button_hover: 'The button colour under the mouse pointer. Leave it on automatic to brighten the button slightly.',
  border: 'Lines around cards, inputs and dividers.',
  link: 'Text links in pages, product details and your account pages.',
  sale: 'Sale and discount badges, error messages.',
  highlight: 'Success messages, “in stock” and “new” badges.',
}

/** The roles in the order the owner reads them (spec §3). */
const MAIN_ROLES: Role[] = ['primary', 'accent', 'canvas', 'surface', 'text', 'heading', 'button', 'button_foreground', 'button_hover', 'border', 'link', 'sale', 'highlight']

/** Which background each text colour is checked against. */
const CONTRAST_WITH: Partial<Record<Role, Role>> = {
  text: 'surface',
  heading: 'surface',
  button_foreground: 'button',
  link: 'canvas',
  primary_foreground: 'primary',
  accent_foreground: 'accent',
}

/** Shown while a B3 role follows another one. */
const ROLE_PLACEHOLDERS: Partial<Record<ThemeRoleColor, string>> = {
  button: 'Same as Primary',
  button_foreground: 'Same as Text on primary',
  button_hover: 'Automatic (slightly brighter)',
  link: 'Same as Secondary',
}

/**
 * Global styles (B3): the theme's colour roles, the store palette, eight ready-made palettes,
 * fonts, the type scale, button shape and card radius. Value in, value out — the Theme page
 * saves it as the draft; the store builder's Site styles drawer previews it on the canvas.
 */
export function GlobalStylesPanel({ settings, onChange, disabled = false, errors = {}, variant = 'page' }: GlobalStylesPanelProps) {
  const colors = colorValues(settings.colors)
  const typography = typographyValues(settings.typography)
  const palette = settings.palette ?? []
  const { shape } = settings

  const setColors = (next: Colors) => onChange({ ...settings, colors: next })
  const setTypography = (next: Partial<ThemeFormValues['typography']>) => onChange({ ...settings, typography: { ...typography, ...next } })
  const setPalette = (next: PaletteEntry[]) => onChange({ ...settings, palette: next })
  const setShape = (next: Partial<ThemeSettings['shape']>) => onChange({ ...settings, shape: { ...shape, ...next } })

  const resolved = Object.fromEntries(MAIN_ROLES.concat(['primary_foreground', 'accent_foreground']).map((role) => [role, effectiveColor(colors, role)])) as Record<Role, string>

  const colorControl = (role: Role) => {
    const optional = role in ROLE_PLACEHOLDERS
    const against = CONTRAST_WITH[role]
    return (
      <div key={role} className="flex flex-col gap-1" data-testid={`role-${role}`}>
        <ColorControl
          label={COLOR_LABELS[role]}
          value={colors[role] ?? null}
          onChange={(value) => {
            if (value === null && !optional) return
            setColors(withColor(colors, role, value))
          }}
          themeColors={resolved}
          palette={palette}
          allowClear={optional}
          placeholder={ROLE_PLACEHOLDERS[role as ThemeRoleColor]}
          tooltip={ROLE_HELP[role]}
          contrastWith={against ? resolved[against] : undefined}
          disabled={disabled}
        />
        {errors[`colors.${role}`] && <p className="text-sm text-destructive">{errors[`colors.${role}`]}</p>}
      </div>
    )
  }

  return (
    <div className={cn('flex flex-col', variant === 'page' ? 'gap-6' : 'gap-0 divide-y')} data-testid="global-styles">
      <Group variant={variant} title="Colour palettes" description="Pick a ready-made set of colours. It changes every colour below; fonts and layout stay.">
        <div role="group" aria-label="Colour palettes" className="grid grid-cols-2 gap-2 @lg:grid-cols-4">
          {PREDEFINED_PALETTES.map((p) => {
            const active = paletteMatches(colors, p)
            return (
              <button
                key={p.key}
                type="button"
                disabled={disabled}
                aria-pressed={active}
                aria-label={`Use the ${p.name} palette`}
                title={p.description}
                onClick={() => setColors(applyPalette(colors, p))}
                className={cn(
                  'flex flex-col gap-2 rounded-lg border bg-card p-2.5 text-left text-sm outline-none transition hover:border-primary/60 focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60',
                  active && 'border-primary ring-2 ring-primary/30',
                )}
              >
                <span className="flex h-8 overflow-hidden rounded-md border" aria-hidden style={{ background: p.colors.canvas }}>
                  {(['primary', 'accent', 'heading', 'highlight', 'sale'] as const).map((role) => (
                    <span key={role} className="flex-1" style={{ background: p.colors[role] }} />
                  ))}
                </span>
                <span className="flex items-center justify-between gap-1 font-medium">
                  {p.name}
                  {active && <CheckIcon className="size-4 text-primary" aria-hidden />}
                </span>
              </button>
            )
          })}
        </div>
      </Group>

      <Group variant={variant} title="Colours" description="Each colour has a job across the store. Text colours show how readable they are on their background.">
        <div className="grid gap-4 @lg:grid-cols-2">{MAIN_ROLES.map(colorControl)}</div>
        <details className="group rounded-md border px-3 py-2">
          <summary className="cursor-pointer text-sm font-medium">Text on coloured backgrounds</summary>
          <div className="mt-3 grid gap-4 pb-1 @lg:grid-cols-2">{(['primary_foreground', 'accent_foreground'] as const).map(colorControl)}</div>
        </details>
        <ContrastChecks colors={colors} />
      </Group>

      <Group variant={variant} title="Store palette" description={`Up to ${MAX_PALETTE_COLORS} colours of your own, offered in every colour picker (here and in the store builder).`}>
        <PaletteEditor palette={palette} onChange={setPalette} disabled={disabled} suggestion={colors.primary} errors={errors} />
      </Group>

      <Group variant={variant} title="Fonts">
        <div className="grid gap-4 @lg:grid-cols-2">
          <FontSelect label="Heading font" value={typography.heading_font} options={HEADING_FONTS} disabled={disabled} onChange={(heading_font) => setTypography({ heading_font: heading_font as ThemeFormValues['typography']['heading_font'] })} error={errors['typography.heading_font']} />
          <FontSelect label="Body font" value={typography.body_font} options={BODY_FONTS} disabled={disabled} onChange={(body_font) => setTypography({ body_font: body_font as ThemeFormValues['typography']['body_font'] })} error={errors['typography.body_font']} />
        </div>
      </Group>

      <Group
        variant={variant}
        title="Text sizes"
        description="One scale for the whole store: headings grow from the body text size by the heading scale."
        action={
          <Button type="button" variant="ghost" size="sm" disabled={disabled || isDefaultScale(typography)} onClick={() => setTypography({ ...TYPE_DEFAULTS })}>
            <RotateCcwIcon data-icon="inline-start" /> Reset sizes
          </Button>
        }
      >
        <TypeScaleControls typography={typography} onChange={setTypography} disabled={disabled} errors={errors} />
        <TypePreview typography={typography} colors={resolved} fonts={typography} buttonStyle={shape.button_style} />
      </Group>

      <Group variant={variant} title="Buttons & cards">
        <div className="grid gap-4 @lg:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <ControlLabel label="Button shape" tooltip="The corners of every button in the store." />
            <div role="radiogroup" aria-label="Button shape" className="flex gap-2">
              {BUTTON_STYLES.map((style) => (
                <button
                  key={style}
                  type="button"
                  role="radio"
                  aria-checked={shape.button_style === style}
                  disabled={disabled}
                  onClick={() => setShape({ button_style: style })}
                  className={cn(
                    'flex flex-1 flex-col items-center gap-1.5 rounded-md border px-2 py-2 text-xs outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60',
                    shape.button_style === style && 'border-primary ring-2 ring-primary/30',
                  )}
                >
                  <span aria-hidden className="h-5 w-12" style={{ background: resolved.button, borderRadius: BUTTON_RADII[style] }} />
                  {BUTTON_LABELS[style]}
                </button>
              ))}
            </div>
          </div>
          <RangeField
            label="Card corner radius"
            tooltip="How round the corners of product cards, images and panels are."
            value={shape.card_radius}
            min={0}
            max={24}
            step={1}
            format={(v) => `${v} px`}
            disabled={disabled}
            error={errors['shape.card_radius']}
            onChange={(card_radius) => setShape({ card_radius })}
          />
        </div>
      </Group>
    </div>
  )
}

function Group({ variant, title, description, action, children }: { variant: 'page' | 'drawer'; title: string; description?: string; action?: ReactNode; children: ReactNode }) {
  if (variant === 'page') {
    return (
      <Card className="@container">
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
          <div className="flex flex-col gap-1.5">
            <CardTitle>{title}</CardTitle>
            {description && <CardDescription>{description}</CardDescription>}
          </div>
          {action}
        </CardHeader>
        <CardContent className="flex flex-col gap-4">{children}</CardContent>
      </Card>
    )
  }
  return (
    <section className="@container flex flex-col gap-3 py-4 first:pt-0" aria-label={title}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-semibold">{title}</h3>
          {description && <p className="text-xs text-muted-foreground">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}

function ContrastChecks({ colors }: { colors: Colors }) {
  return (
    <div className="flex flex-col gap-2">
      <h4 className="text-sm font-medium">Readability (WCAG AA, 4.5:1)</h4>
      <ul className="flex flex-col gap-1.5 text-sm" aria-label="Contrast checks">
        {contrastPairs({ colors }).map((pair) => {
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
                <span className="text-muted-foreground tabular-nums">{ratio ? `${ratio.toFixed(1)}:1` : '—'}</span>
                <Badge variant={pass ? 'success' : 'warning'}>{pass ? 'AA pass' : 'Below AA'}</Badge>
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function PaletteEditor({ palette, onChange, disabled, suggestion, errors }: { palette: PaletteEntry[]; onChange: (next: PaletteEntry[]) => void; disabled: boolean; suggestion: string; errors: Record<string, string | undefined> }) {
  const update = (index: number, entry: Partial<PaletteEntry>) => onChange(palette.map((c, i) => (i === index ? { ...c, ...entry } : c)))
  const full = palette.length >= MAX_PALETTE_COLORS

  return (
    <div className="flex flex-col gap-3">
      {palette.length === 0 ? (
        <p className="text-sm text-muted-foreground">No saved colours yet.</p>
      ) : (
        <ul className="flex flex-col gap-3" aria-label="Store palette colours">
          {palette.map((entry, index) => {
            const nameError = errors[`palette.${index}.name`]
            const hexError = errors[`palette.${index}.hex`]
            return (
              <li key={index} className="grid grid-cols-[1fr_auto] items-end gap-2 @lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                <div className="col-span-2 flex flex-col gap-1.5 @lg:col-span-1">
                  <Label htmlFor={`palette-name-${index}`}>Colour {index + 1} name</Label>
                  <Input id={`palette-name-${index}`} value={entry.name} maxLength={PALETTE_NAME_MAX} disabled={disabled} aria-invalid={nameError ? true : undefined} onChange={(e) => update(index, { name: e.target.value })} />
                  {nameError && <p className="text-sm text-destructive">{nameError}</p>}
                </div>
                <div className="flex flex-col gap-1">
                  <ColorControl label={`Colour ${index + 1}`} value={entry.hex} onChange={(hex) => hex && update(index, { hex })} allowAlpha disabled={disabled} />
                  {hexError && <p className="text-sm text-destructive">{hexError}</p>}
                </div>
                <Button type="button" variant="ghost" size="icon" disabled={disabled} aria-label={`Remove ${entry.name || `colour ${index + 1}`}`} onClick={() => onChange(palette.filter((_, i) => i !== index))}>
                  <Trash2Icon />
                </Button>
              </li>
            )
          })}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="outline" size="sm" className="self-start" disabled={disabled || full} onClick={() => onChange([...palette, { name: `Colour ${palette.length + 1}`, hex: suggestion.toLowerCase() }])}>
          <PlusIcon data-icon="inline-start" /> Add colour
        </Button>
        {palette.length > 0 && (
          <span className="flex items-center gap-1" aria-hidden>
            {palette.map((c, i) => (
              <Swatch key={i} color={c.hex} />
            ))}
          </span>
        )}
        {full && <span className="text-sm text-muted-foreground">The palette is full ({MAX_PALETTE_COLORS} colours).</span>}
      </div>
      {errors.palette && <p className="text-sm text-destructive">{errors.palette}</p>}
    </div>
  )
}

function FontSelect({ label, value, options, onChange, disabled, error }: { label: string; value: string; options: readonly string[]; onChange: (value: string) => void; disabled: boolean; error?: string }) {
  const id = useId()
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger id={id} className="w-full" aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((f) => (
            <SelectItem key={f} value={f}>
              <span style={{ fontFamily: FONT_FAMILIES[f] }}>{FONT_LABELS[f]}</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  )
}

/** A labelled slider with its value; native range input, so keyboard and screen readers work. */
export function RangeField({ label, tooltip, value, min, max, step, format, onChange, disabled, error, hint }: {
  label: string
  tooltip?: string
  value: number
  min: number
  max: number
  step: number
  format: (value: number) => string
  onChange: (value: number) => void
  disabled?: boolean
  error?: string
  hint?: string
}) {
  const id = useId()
  return (
    <div className="flex flex-col gap-1.5">
      <ControlLabel label={label} htmlFor={id} tooltip={tooltip} status={<span className="text-sm text-muted-foreground tabular-nums">{format(value)}</span>} />
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-valuetext={format(value)}
        aria-invalid={error ? true : undefined}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-primary disabled:opacity-50"
      />
      {error ? <p className="text-sm text-destructive">{error}</p> : hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

type Typography = ThemeFormValues['typography']

function isDefaultScale(typography: Typography): boolean {
  return (Object.keys(TYPE_DEFAULTS) as (keyof ThemeTypeScale)[]).every((key) => typography[key] === TYPE_DEFAULTS[key])
}

/** Rounds slider values to their step (floating point steps such as 0.01 drift). */
const snap = (value: number, step: number) => Number((Math.round(value / step) * step).toFixed(3))

function TypeScaleControls({ typography, onChange, disabled, errors }: { typography: Typography; onChange: (next: Partial<Typography>) => void; disabled: boolean; errors: Record<string, string | undefined> }) {
  const range = (key: keyof ThemeTypeScale) => ({ ...TYPE_LIMITS[key], value: typography[key], disabled, error: errors[`typography.${key}`], onChange: (v: number) => onChange({ [key]: snap(v, TYPE_LIMITS[key].step) }) })
  const weightId = useId()

  return (
    <div className="grid gap-4 @lg:grid-cols-2">
      <RangeField label="Body text size" tooltip="The size of paragraphs and most text. Small text and headings grow or shrink with it." format={(v) => `${v} px`} hint="Default 16 px" {...range('body_size')} />
      <RangeField label="Heading scale" tooltip="How much bigger each heading level is than the one below it. Higher = more dramatic headings." format={(v) => `× ${v.toFixed(2)}`} hint="Default × 1.25" {...range('heading_scale')} />
      <RangeField label="Line height" tooltip="Space between lines of body text. More space reads easier in long text." format={(v) => v.toFixed(2)} hint="Default 1.50" {...range('line_height')} />
      <RangeField label="Headings on phones" tooltip="Shrinks headings on small screens so long titles fit." format={(v) => `${Math.round(v * 100)} %`} hint="Default 100 %" {...range('mobile_scale')} />
      <RangeField label="Heading letter spacing" tooltip="Space between the letters of headings. Slightly negative looks tighter and bolder." format={(v) => `${Number(v.toFixed(3))} em`} hint="Default 0 em" {...range('letter_spacing')} />
      <div className="flex flex-col gap-1.5">
        <ControlLabel label="Heading weight" htmlFor={weightId} tooltip="Bold keeps each heading’s designed weight; lighter or heavier shifts every heading by the same amount." />
        <Select value={String(typography.heading_weight)} onValueChange={(v) => onChange({ heading_weight: Number(v) })} disabled={disabled}>
          <SelectTrigger id={weightId} className="w-full" aria-label="Heading weight">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {HEADING_WEIGHTS.map((w) => (
              <SelectItem key={w.value} value={String(w.value)}>
                <span style={{ fontWeight: w.value }}>{w.label}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {errors['typography.heading_weight'] && <p className="text-sm text-destructive">{errors['typography.heading_weight']}</p>}
      </div>
    </div>
  )
}

/** A miniature of the scale in the theme's fonts and colours, with the sizes it produces. */
function TypePreview({ typography, colors, fonts, buttonStyle }: { typography: Typography; colors: Record<Role, string>; fonts: Pick<Typography, 'heading_font' | 'body_font'>; buttonStyle: string }) {
  const samples = typeSamples(typography)
  const shift = typography.heading_weight - 700
  const headingFont = FONT_FAMILIES[fonts.heading_font]
  const bodyFont = FONT_FAMILIES[fonts.body_font]
  const spacing = typography.letter_spacing === 0 ? undefined : `${typography.letter_spacing}em`
  const [title, heading] = samples

  return (
    <div className="grid gap-4 @lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <div className="flex flex-col gap-2 overflow-hidden rounded-lg border p-4" style={{ background: colors.canvas, color: colors.text, fontFamily: bodyFont }} data-testid="type-preview" aria-label="Text preview" role="img">
        <span style={{ fontFamily: headingFont, color: colors.heading, fontSize: title?.desktop, fontWeight: Math.min(900, 800 + shift), letterSpacing: spacing, lineHeight: 1.15 }}>Fresh arrivals</span>
        <span style={{ fontFamily: headingFont, color: colors.heading, fontSize: heading?.desktop, fontWeight: Math.min(900, 700 + shift), letterSpacing: spacing, lineHeight: 1.3 }}>This week’s picks</span>
        <p style={{ fontSize: samples[3]?.desktop, lineHeight: typography.line_height }}>
          Hand-picked products delivered to your door. <span style={{ color: colors.link, textDecoration: 'underline' }}>Read our story</span>
        </p>
        <span className="self-start px-4 py-2 text-xs font-bold tracking-wide uppercase" style={{ background: colors.button, color: colors.button_foreground, borderRadius: BUTTON_RADII[buttonStyle] }}>
          Shop now
        </span>
      </div>
      <table className="self-start text-sm">
        <caption className="sr-only">Text sizes</caption>
        <thead>
          <tr className="text-left text-xs text-muted-foreground">
            <th scope="col" className="pb-1 font-medium">Text</th>
            <th scope="col" className="pb-1 text-right font-medium">Desktop</th>
            <th scope="col" className="pb-1 text-right font-medium">Phone</th>
          </tr>
        </thead>
        <tbody>
          {samples.map((s) => (
            <tr key={s.label}>
              <th scope="row" className="py-0.5 pr-2 text-left font-normal">{s.label}</th>
              <td className="py-0.5 text-right tabular-nums">{s.desktop} px</td>
              <td className="py-0.5 text-right tabular-nums">{s.phone} px</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
