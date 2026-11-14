import { useEffect, useId } from 'react'
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ControlLabel } from '@/features/store-builder/controls'
import type { StoreFont } from '@/features/storefront/api'
import type { ThemeFormValues } from '@/features/storefront/theme-form'
import { loadFont } from '@/storefront/font-loader'
import { BANGLA_SAMPLE, BANGLA_TYPE_DEFAULTS, BANGLA_TYPE_LIMITS, isBuiltInFont } from '@/storefront/fonts'
import { RangeField } from './range-field'
import { useFontFaces } from './use-font-faces'
import { automaticBanglaFont, effectiveBanglaFont, fontGroups, fontName, previewStack, type FontGroup, type FontPickerRole } from './typography-model'

/*
 * B10 typography fields of the global styles panel (Theme page and the builder's Site styles):
 * heading and body fonts, fonts for Bangla text, Bangla line spacing and size. Every picker shows
 * its font in a sample in English and in Bangla; the fonts load on demand (storefront font loader)
 * and uploaded fonts get their @font-face here.
 */

type Typography = ThemeFormValues['typography']

const ENGLISH_SAMPLE = 'Welcome to our shop'
const AUTO = '__automatic'

/** Loads the built-in fonts of these keys (for the samples). */
function useLoadFonts(keys: readonly (string | null | undefined)[]) {
  const list = keys.filter((key): key is string => isBuiltInFont(key)).join(',')
  useEffect(() => {
    for (const key of list.split(',')) if (key) void loadFont(key)
  }, [list])
}

export function FontSample({ stack, english = true, lineHeight, scale = 1, testId }: { stack: string; english?: boolean; lineHeight?: number; scale?: number; testId?: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-md border bg-muted/30 px-3 py-2" data-testid={testId} aria-hidden>
      {english && <span className="truncate text-base" style={{ fontFamily: stack }}>{ENGLISH_SAMPLE}</span>}
      <span lang="bn" className="text-base" style={{ fontFamily: stack, lineHeight, fontSize: `${scale}em` }}>
        {BANGLA_SAMPLE}
      </span>
    </div>
  )
}

function FontPicker({ role, label, tooltip, value, onChange, groups, custom, automatic, disabled, error, sample }: {
  role: FontPickerRole
  label: string
  tooltip: string
  value: string | null
  onChange: (value: string | null) => void
  groups: FontGroup[]
  custom: readonly StoreFont[]
  /** Bangla pickers: the "Automatic" choice (null) and the font it means. */
  automatic?: string
  disabled: boolean
  error?: string
  sample: { stack: string; english: boolean; lineHeight?: number; scale?: number }
}) {
  const id = useId()
  const known = groups.some((g) => g.options.some((o) => o.value === value))
  const selectValue = value === null ? AUTO : value
  return (
    <div className="flex flex-col gap-1.5" data-testid={`font-picker-${role}`}>
      <ControlLabel label={label} htmlFor={id} tooltip={tooltip} />
      <Select
        value={selectValue}
        onValueChange={(next) => onChange(next === AUTO ? null : next)}
        onOpenChange={(open) => {
          // Draw every option in its own font.
          if (open) for (const g of groups) for (const o of g.options) if (!o.custom) void loadFont(o.value)
        }}
        disabled={disabled}
      >
        <SelectTrigger id={id} className="w-full" aria-label={label} aria-invalid={error ? true : undefined}>
          <SelectValue>{value === null ? `Automatic (${fontName(automatic, custom)})` : fontName(value, custom)}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {automatic !== undefined && (
            <>
              <SelectItem value={AUTO}>
                <span className="flex flex-col">
                  <span>Automatic ({fontName(automatic, custom)})</span>
                  <span className="text-xs text-muted-foreground">Follows the main font when it writes Bangla</span>
                </span>
              </SelectItem>
              <SelectSeparator />
            </>
          )}
          {!known && value !== null && <SelectItem value={value}>{fontName(value, custom)}</SelectItem>}
          {groups.map((group) => (
            <SelectGroup key={group.label}>
              <SelectLabel>{group.label}</SelectLabel>
              {group.options.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  <span className="flex flex-col">
                    <span style={{ fontFamily: option.stack }}>
                      {option.label}
                      {option.bengali && !option.custom && (
                        <span lang="bn" className="ml-2 text-muted-foreground">
                          বাংলা
                        </span>
                      )}
                    </span>
                    <span className="text-xs text-muted-foreground">{option.hint}</span>
                  </span>
                </SelectItem>
              ))}
            </SelectGroup>
          ))}
        </SelectContent>
      </Select>
      <FontSample stack={sample.stack} english={sample.english} lineHeight={sample.lineHeight} scale={sample.scale} testId={`font-sample-${role}`} />
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  )
}

/** Rounds slider values to their step (floating point steps drift). */
const snap = (value: number, step: number) => Number((Math.round(value / step) * step).toFixed(3))

export function TypographyFields({ typography, onChange, custom, disabled, errors }: {
  typography: Typography
  onChange: (next: Partial<Typography>) => void
  /** The store's uploaded fonts (offered in every picker). */
  custom: readonly StoreFont[]
  disabled: boolean
  errors: Record<string, string | undefined>
}) {
  const banglaHeading = effectiveBanglaFont('bangla_heading', typography, custom)
  const banglaBody = effectiveBanglaFont('bangla_body', typography, custom)
  useFontFaces(custom)
  useLoadFonts([typography.heading_font, typography.body_font, banglaHeading, banglaBody])
  const lineHeight = typography.bangla_line_height ?? BANGLA_TYPE_DEFAULTS.bangla_line_height
  const scale = typography.bangla_scale ?? BANGLA_TYPE_DEFAULTS.bangla_scale
  const range = (key: keyof typeof BANGLA_TYPE_LIMITS) => ({
    ...BANGLA_TYPE_LIMITS[key],
    value: typography[key] ?? BANGLA_TYPE_DEFAULTS[key],
    disabled,
    error: errors[`typography.${key}`],
    onChange: (v: number) => onChange({ [key]: snap(v, BANGLA_TYPE_LIMITS[key].step) }),
  })

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 @lg:grid-cols-2">
        <FontPicker
          role="heading"
          label="Heading font"
          tooltip="Titles and headings across the store. Fonts marked বাংলা also write Bangla."
          value={typography.heading_font}
          onChange={(v) => v && onChange({ heading_font: v as Typography['heading_font'] })}
          groups={fontGroups('heading', custom)}
          custom={custom}
          disabled={disabled}
          error={errors['typography.heading_font']}
          sample={{ stack: previewStack(typography.heading_font, custom), english: true }}
        />
        <FontPicker
          role="body"
          label="Body font"
          tooltip="Paragraphs, prices, buttons and menus."
          value={typography.body_font}
          onChange={(v) => v && onChange({ body_font: v as Typography['body_font'] })}
          groups={fontGroups('body', custom)}
          custom={custom}
          disabled={disabled}
          error={errors['typography.body_font']}
          sample={{ stack: previewStack(typography.body_font, custom), english: true }}
        />
      </div>

      <fieldset className="flex flex-col gap-4 rounded-md border p-3" data-testid="bangla-typography">
        <legend className="px-1 text-sm font-medium">
          Bangla text <span lang="bn" className="text-muted-foreground">(বাংলা)</span>
        </legend>
        <p className="text-xs text-muted-foreground">Bangla letters need a little more room. These fonts and spacing apply only to Bangla text; English keeps the fonts above.</p>
        <div className="grid gap-4 @lg:grid-cols-2">
          <FontPicker
            role="bangla_heading"
            label="Bangla heading font"
            tooltip="Headings in Bangla. Automatic uses the heading font when it writes Bangla, else Baloo Da 2."
            value={typography.bangla_heading_font ?? null}
            onChange={(v) => onChange({ bangla_heading_font: v as Typography['bangla_heading_font'] })}
            groups={fontGroups('bangla_heading', custom)}
            custom={custom}
            automatic={automaticBanglaFont('bangla_heading', typography, custom)}
            disabled={disabled}
            error={errors['typography.bangla_heading_font']}
            sample={{ stack: previewStack(banglaHeading, custom), english: false, lineHeight, scale }}
          />
          <FontPicker
            role="bangla_body"
            label="Bangla text font"
            tooltip="Paragraphs and other text in Bangla. Automatic uses the body font when it writes Bangla, else Hind Siliguri."
            value={typography.bangla_body_font ?? null}
            onChange={(v) => onChange({ bangla_body_font: v as Typography['bangla_body_font'] })}
            groups={fontGroups('bangla_body', custom)}
            custom={custom}
            automatic={automaticBanglaFont('bangla_body', typography, custom)}
            disabled={disabled}
            error={errors['typography.bangla_body_font']}
            sample={{ stack: previewStack(banglaBody, custom), english: false, lineHeight, scale }}
          />
          <RangeField label="Bangla line spacing" tooltip="Space between lines of Bangla text. Bangla letters have marks above and below, so they need more room than English." format={(v) => v.toFixed(2)} hint={`Default ${BANGLA_TYPE_DEFAULTS.bangla_line_height.toFixed(2)}`} {...range('bangla_line_height')} />
          <RangeField label="Bangla text size" tooltip="Makes Bangla text a little bigger or smaller than English text of the same kind." format={(v) => `${Math.round(v * 100)} %`} hint="Default 100 %" {...range('bangla_scale')} />
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">Preview</span>
          <div className="rounded-md border p-3" data-testid="bangla-preview" aria-hidden>
            <p lang="bn" className="text-lg font-bold" style={{ fontFamily: previewStack(banglaHeading, custom), fontSize: `${1.125 * scale}rem`, lineHeight: 1.3 }}>
              {BANGLA_SAMPLE}
            </p>
            <p lang="bn" className="text-sm" style={{ fontFamily: previewStack(banglaBody, custom), fontSize: `${0.875 * scale}rem`, lineHeight }}>
              তাজা পণ্য, সঠিক দাম। আজই অর্ডার করুন, ঢাকার ভেতরে একদিনে ডেলিভারি।
            </p>
          </div>
        </div>
      </fieldset>
    </div>
  )
}
