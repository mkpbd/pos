import { useId, useState, type ReactNode } from 'react'
import { XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { THEME_COLOR_ROLES } from '@/storefront/builder/validate'
import { contrast, CURATED_COLORS, describeColor, isThemeToken, parseColor, resolveColor, roleLabel, toHex, toRgbString, type PaletteColor } from './color-utils'
import { ControlLabel } from './control-label'
import { PaletteSwatches, Swatch, SwatchButton } from './palette-swatches'

export type ColorControlProps = {
  label: string
  /** `#rrggbb`, `#rrggbbaa`, `theme:<role>` or null (nothing chosen). */
  value: string | null
  onChange(value: string | null): void
  /** The theme's colours by role, to paint the theme swatches and resolve `theme:` values. */
  themeColors?: Record<string, string>
  /** Offer the theme colours as `theme:<role>` (the value then follows the theme). */
  allowTokens?: boolean
  /** Which roles to offer as tokens (default: every role a builder style may use). */
  tokenRoles?: readonly string[]
  /** Offer an opacity slider; see-through colours are stored as `#rrggbbaa`. */
  allowAlpha?: boolean
  /** The store's saved colours. */
  palette?: readonly PaletteColor[]
  /** Offer "Clear" (back to null). */
  allowClear?: boolean
  description?: string
  /** Plain-language help behind an (i). */
  tooltip?: string
  /** A background to check readability against (hex or `theme:<role>`); shows the contrast ratio. */
  contrastWith?: string | null
  /** Shown on the button when the value is null, e.g. "Theme default". */
  placeholder?: string
  /** The per-device indicator slot (Style tab). */
  status?: ReactNode
  disabled?: boolean
}

/**
 * A colour field: a swatch button showing the value that opens the colour editor (theme colours,
 * the store palette, 12 curated colours, hex and RGB(A) fields, the browser's picker and an
 * opacity slider). Invalid typing is flagged and never written.
 */
export function ColorControl(props: ColorControlProps) {
  const { label, value, onChange, themeColors, allowClear = false, description, tooltip, contrastWith, placeholder, status, disabled } = props
  const id = useId()
  const [open, setOpen] = useState(false)
  const shown = resolveColor(value, themeColors)
  const ratio = contrastWith !== undefined && contrastWith !== null ? contrast(shown, resolveColor(contrastWith, themeColors)) : null

  return (
    <div className="flex flex-col gap-1.5" data-control="color">
      <ControlLabel label={label} id={`${id}-label`} tooltip={tooltip} status={status} />
      <div className="flex items-center gap-1.5">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              disabled={disabled}
              aria-label={`${label}: ${describeColor(value, placeholder)}. Change colour`}
              aria-describedby={description ? `${id}-desc` : undefined}
              className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-md border bg-transparent px-2.5 text-left text-sm shadow-xs outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Swatch color={shown} />
              <span className={cn('min-w-0 truncate', !value && 'text-muted-foreground', value && !isThemeToken(value) && 'font-mono')}>{describeColor(value, placeholder)}</span>
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-72" aria-label={`${label} colour`}>
            <ColorEditor {...props} />
          </PopoverContent>
        </Popover>
        {allowClear && value !== null && (
          <Button type="button" variant="ghost" size="icon-sm" disabled={disabled} aria-label={`Clear ${label}`} title="Clear" onClick={() => onChange(null)}>
            <XIcon />
          </Button>
        )}
      </div>
      {description && <p id={`${id}-desc`} className="text-xs text-muted-foreground">{description}</p>}
      {ratio !== null && <ContrastHint ratio={ratio} />}
    </div>
  )
}

export function ContrastHint({ ratio }: { ratio: number }) {
  const good = ratio >= 4.5
  const large = ratio >= 3
  return (
    <p className={cn('text-xs', good ? 'text-muted-foreground' : 'text-amber-700 dark:text-amber-400')} data-testid="contrast-hint">
      Contrast {ratio.toFixed(1)}:1 — {good ? 'easy to read.' : large ? 'fine for large text only.' : 'hard to read; pick a darker or lighter colour.'}
    </p>
  )
}

/** The editor inside the popover (also usable inline, e.g. for gradient stops). */
export function ColorEditor({ label, value, onChange, themeColors, allowTokens = false, tokenRoles = THEME_COLOR_ROLES, allowAlpha = false, palette = [], disabled }: ColorControlProps) {
  const id = useId()
  const parsed = isThemeToken(value) ? null : parseColor(value)
  const resolved = resolveColor(value, themeColors)
  const alpha = parsed?.a ?? 1

  // What the person is typing; re-synced when the value changes from elsewhere.
  const [hexText, setHexText] = useState(() => (parsed ? toHex(parsed, allowAlpha) : ''))
  const [rgbText, setRgbText] = useState(() => (parsed ? toRgbString(parsed) : ''))
  const [hexError, setHexError] = useState<string | null>(null)
  const [rgbError, setRgbError] = useState<string | null>(null)
  const [seen, setSeen] = useState(value)
  if (seen !== value) {
    setSeen(value)
    const next = isThemeToken(value) ? null : parseColor(value)
    setHexText(next ? toHex(next, allowAlpha) : '')
    setRgbText(next ? toRgbString(next) : '')
    setHexError(null)
    setRgbError(null)
  }

  const write = (next: string | null) => {
    if (next !== value) onChange(next)
  }

  const commitText = (text: string, kind: 'hex' | 'rgb') => {
    const setError = kind === 'hex' ? setHexError : setRgbError
    if (text.trim() === '') return setError(null)
    const c = parseColor(text)
    if (!c) return setError(kind === 'hex' ? 'Use 6 hex digits, like #1d4ed8.' : 'Use rgb(29, 78, 216) or rgba(29, 78, 216, 0.5).')
    if (c.a < 1 && !allowAlpha) return setError('See-through colours aren’t available here.')
    setError(null)
    write(toHex(c, allowAlpha))
  }

  const tokens = allowTokens ? tokenRoles.filter((role) => (THEME_COLOR_ROLES as readonly string[]).includes(role)) : []

  return (
    <div className="flex flex-col gap-3" data-testid="color-editor">
      {tokens.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">Theme colours (change with the theme)</span>
          <div role="group" aria-label="Theme colours" className="flex flex-wrap gap-1.5">
            {tokens.map((role) => (
              <SwatchButton
                key={role}
                name={`Theme colour: ${roleLabel(role)}`}
                title={`${roleLabel(role)} — follows the theme`}
                color={themeColors?.[role]}
                active={value === `theme:${role}`}
                disabled={disabled}
                onClick={() => write(`theme:${role}`)}
              />
            ))}
          </div>
        </div>
      )}
      <PaletteSwatches label="Store palette" colors={palette} value={value} disabled={disabled} onSelect={(hex) => write(hex)} />
      <PaletteSwatches label="Colours" colors={CURATED_COLORS} value={value} disabled={disabled} onSelect={(hex) => write(hex)} />

      <div className="grid grid-cols-[auto_1fr] items-center gap-2">
        <input
          type="color"
          aria-label={`${label} picker`}
          disabled={disabled}
          value={resolved ? resolved.slice(0, 7) : '#000000'}
          onChange={(e) => {
            const c = parseColor(e.target.value)
            if (c) write(toHex({ ...c, a: allowAlpha ? alpha : 1 }, allowAlpha))
          }}
          className="h-9 w-11 cursor-pointer rounded-md border bg-transparent p-1 disabled:cursor-not-allowed"
        />
        <Input
          id={`${id}-hex`}
          aria-label={`${label} hex value`}
          placeholder={isThemeToken(value) ? `${roleLabel(value.slice(6))} (theme)` : allowAlpha ? '#rrggbb or #rrggbbaa' : '#rrggbb'}
          value={hexText}
          maxLength={9}
          spellCheck={false}
          disabled={disabled}
          className="font-mono"
          aria-invalid={hexError ? true : undefined}
          aria-describedby={hexError ? `${id}-hex-error` : undefined}
          onChange={(e) => {
            setHexText(e.target.value)
            // Write as soon as it is a full colour; partial typing waits.
            const text = e.target.value.trim()
            if (/^#?([0-9a-f]{6}|[0-9a-f]{8})$/i.test(text)) commitText(text, 'hex')
            else setHexError(null)
          }}
          onBlur={() => commitText(hexText, 'hex')}
          onKeyDown={(e) => e.key === 'Enter' && commitText(hexText, 'hex')}
        />
      </div>
      {hexError && <p id={`${id}-hex-error`} className="-mt-1 text-xs text-destructive">{hexError}</p>}

      <Input
        aria-label={`${label} RGB value`}
        placeholder={allowAlpha ? 'rgba(29, 78, 216, 0.5)' : 'rgb(29, 78, 216)'}
        value={rgbText}
        spellCheck={false}
        disabled={disabled}
        className="font-mono text-xs"
        aria-invalid={rgbError ? true : undefined}
        aria-describedby={rgbError ? `${id}-rgb-error` : undefined}
        onChange={(e) => {
          setRgbText(e.target.value)
          setRgbError(null)
        }}
        onBlur={() => commitText(rgbText, 'rgb')}
        onKeyDown={(e) => e.key === 'Enter' && commitText(rgbText, 'rgb')}
      />
      {rgbError && <p id={`${id}-rgb-error`} className="-mt-1 text-xs text-destructive">{rgbError}</p>}

      {allowAlpha && (
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between text-xs">
            <label htmlFor={`${id}-alpha`} className="font-medium">Opacity</label>
            <span className="text-muted-foreground tabular-nums">{Math.round(alpha * 100)} %</span>
          </div>
          <input
            id={`${id}-alpha`}
            type="range"
            min={0}
            max={100}
            step={1}
            aria-label={`${label} opacity`}
            disabled={disabled || !parsed}
            value={Math.round(alpha * 100)}
            onChange={(e) => {
              if (!parsed) return
              write(toHex({ ...parsed, a: Number(e.target.value) / 100 }, true))
            }}
            className="w-full accent-primary disabled:opacity-50"
          />
          {isThemeToken(value) && <p className="text-xs text-muted-foreground">Theme colours are always solid. Pick a fixed colour to make it see-through.</p>}
        </div>
      )}
    </div>
  )
}
