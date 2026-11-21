/*
 * Content tab forms of the B20 elements: the animated icon (a searchable picker grouped by theme
 * with English and Bangla words, each tile playing its animation while pointed at or focused;
 * animation, when it plays, size, line weight, colour with a contrast hint, background shape and
 * the screen reader name or "Decorative") and the illustration (a picker of animated thumbnails,
 * when it plays, size, position, colours and its description or "Decorative"). The drawings are
 * the storefront's lazy chunks; under "reduce motion" the previews stay still.
 *
 * Every tile's drawing sits in a `pointer-events: none` layer, so a press always lands on the tile
 * button itself: while a drawing's chunk loads, its Suspense placeholder is replaced by the drawing,
 * and a press that started on the (removed) placeholder would end without a click.
 */

import { lazy, Suspense, useId, useState, type CSSProperties, type ReactNode } from 'react'
import { CheckIcon, RotateCcwIcon, SearchIcon, TriangleAlertIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { ANIMATED_ICON_NAMES, ILLUSTRATION_NAMES } from '@/storefront/builder/graphics/names'
import { ICON_GROUPS, ICON_KEYWORDS, ILLUSTRATION_LABELS } from '@/storefront/builder/graphics/icon-catalog'
import type { AnimatedIconAnimation, AnimatedIconElement, AnimatedIconProps, Element, IllustrationElement, IllustrationProps } from '@/storefront/builder/types'
import { B20_LIMITS, B20_TEXT_LIMITS } from '@/storefront/builder/validate'
import { prefersReducedMotion } from './b18-motion'
import { TileGroup } from './b18-motion-tiles'
import {
  B20_ALIGN,
  ICON_ANIMATIONS,
  ICON_BACKGROUNDS,
  ICON_COLOR_ROLES,
  ICON_SIZES,
  ICON_STROKES,
  ICON_TRIGGERS,
  ILLUSTRATION_PALETTES,
  ILLUSTRATION_PLAYS,
  ILLUSTRATION_SIZES,
  iconColor,
  iconContrastHint,
  iconGroups,
  iconKeywords,
  iconTitle,
  humanize,
  illustrationLabels,
  namesFrom,
  roleColor,
  searchIcons,
  themeVars,
  withColorRole,
  withoutKey,
} from './b20-model'
import { FieldError } from './fields'
import { Bangla, Note } from './form-kit'
import { limitIn, patch, type ElementFormProps } from './form-model'
import { ChoiceField, PixelField, TextField, ToggleField } from './pickers'

const AnimatedIconArt = lazy(() => import('@/storefront/builder/graphics/animated-icon'))
const IllustrationArt = lazy(() => import('@/storefront/builder/graphics/illustration'))

export type B20FormProps<N> = ElementFormProps<N> & {
  /** GET /elements `enums` (icon names, groups and keywords, illustration names and labels). */
  enums?: Record<string, unknown>
  /** The store theme's colours (previews in the shop's colours). */
  theme?: { colors?: Record<string, string> }
}

const limit = (type: string, field: string) => limitIn(B20_TEXT_LIMITS as Record<string, Record<string, number>>, type, field)

/** A row of small toggle buttons (one choice). */
function Segmented<V extends string | number>({ label, value, options, onChange, testId }: { label: string; value: V; options: readonly { value: V; label: string; hint?: string }[]; onChange: (value: V) => void; testId?: string }) {
  const id = useId()
  return (
    <div className="flex flex-col gap-1.5" data-testid={testId}>
      <span id={id} className="text-sm font-medium">
        {label}
      </span>
      <div role="group" aria-labelledby={id} className="flex flex-wrap gap-1.5">
        {options.map((o) => (
          <Button key={String(o.value)} type="button" size="sm" variant={value === o.value ? 'default' : 'outline'} aria-pressed={value === o.value} title={o.hint} onClick={() => onChange(o.value)}>
            {o.label}
          </Button>
        ))}
      </div>
    </div>
  )
}

/** A still placeholder while a drawing's chunk loads. */
function Loading({ size }: { size: number }) {
  return <span aria-hidden className="inline-block animate-none rounded-md bg-muted" style={{ width: size, height: size }} />
}

/** The "Decorative" switch over the screen reader text; switching on empties it (and its Bangla). */
function Description<N extends Element & { props: Record<string, unknown> }>(props: ElementFormProps<N> & { field: 'label' | 'alt'; value: string; start: string; label: string; switchLabel: string; hint: string; max: number; multiline?: boolean; error?: string }) {
  const { node, onChange, field, value, start, label, switchLabel, hint, max, multiline, error } = props
  const [decorative, setDecorative] = useState(value === '')
  return (
    <div className="flex flex-col gap-3">
      <ToggleField
        label={switchLabel}
        hint="Screen readers skip it. Choose this when the words next to it already say what it shows."
        checked={decorative}
        onChange={(on) => {
          setDecorative(on)
          if (on) onChange({ ...node, props: { ...node.props, [field]: '' }, translations: withoutKey(node.translations, field) })
          else if (value === '') patch(node, onChange, { [field]: start } as Partial<N['props']>)
        }}
      />
      {!decorative && (
        <>
          <TextField label={label} hint={hint} value={value} max={max} multiline={multiline} error={error} onChange={(text) => patch(node, onChange, { [field]: text } as Partial<N['props']>, field)} />
          <Bangla {...props} fields={[{ name: field, label, base: value }]} />
        </>
      )}
      {decorative && <FieldError message={error} />}
    </div>
  )
}

/* ----------------------------------------------------------------------------------------------
 * Animated icon
 * -------------------------------------------------------------------------------------------- */

/** The icon on its background shape (a light tint of its colour), drawn by the store's own code; plays once per `playKey`. */
function IconStage({ props, color, size, playing, playKey }: { props: AnimatedIconProps; color: string; size: number; playing: boolean; playKey?: number }) {
  return (
    <Suspense fallback={<Loading size={size} />}>
      <AnimatedIconArt key={playKey} name={props.name} animation={props.animation} size={size} stroke={props.stroke} color={color} background={props.background} trigger="view" playing={playing} />
    </Suspense>
  )
}

export function AnimatedIconPicker({ value, names, groups, keywords, animation, stroke, color, onChange, error }: {
  value: string
  names: readonly string[]
  groups: ReturnType<typeof iconGroups>
  keywords: ReturnType<typeof iconKeywords>
  /** The chosen animation: each tile plays it while pointed at or focused. */
  animation: AnimatedIconAnimation
  stroke: number
  color: string
  onChange: (name: string) => void
  error?: string
}) {
  const legendId = useId()
  const [query, setQuery] = useState('')
  const [active, setActive] = useState<string | null>(null)
  const shown = searchIcons(groups, keywords, query)
  const count = shown.reduce((n, g) => n + g.icons.length, 0)
  const preview: AnimatedIconAnimation = animation === 'none' ? 'draw' : animation
  const still = prefersReducedMotion()
  return (
    <fieldset className="flex flex-col gap-2" aria-describedby={error ? `${legendId}-error` : undefined} data-testid="animated-icon-picker">
      <legend id={legendId} className="mb-1.5 text-sm font-medium">
        Icon
      </legend>
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input type="search" aria-label="Search icons" placeholder="Search: delivery, ডেলিভারি, gift…" value={query} onChange={(e) => setQuery(e.target.value)} className="pl-8" />
      </div>
      <p className="sr-only" role="status">
        {query ? `${count} ${count === 1 ? 'icon' : 'icons'} found` : ''}
      </p>
      {count === 0 && <p className="text-sm text-muted-foreground">No icon matches “{query}”. Try another word, in English or Bangla.</p>}
      <div className="flex max-h-80 flex-col gap-3 overflow-y-auto pr-1">
        {shown.map((group) => (
          <div key={group.key} role="group" aria-label={group.label} className="flex flex-col gap-1.5">
            <p className="text-xs font-medium text-muted-foreground">
              {group.label}
              {group.label_bn && (
                <>
                  {' · '}
                  <span lang="bn">{group.label_bn}</span>
                </>
              )}
            </p>
            <div className="grid grid-cols-4 gap-1.5 p-0.5">
              {group.icons.map((name) => {
                const checked = name === value
                const title = iconTitle(name, keywords)
                return (
                  <button
                    key={name}
                    type="button"
                    aria-pressed={checked}
                    aria-label={title.en}
                    title={title.bn ? `${title.en} (${title.bn})` : title.en}
                    onClick={() => onChange(name)}
                    onPointerEnter={() => setActive(name)}
                    onPointerLeave={() => setActive((a) => (a === name ? null : a))}
                    onFocus={() => setActive(name)}
                    onBlur={() => setActive((a) => (a === name ? null : a))}
                    data-testid={`animated-icon-${name}`}
                    data-playing={active === name && !still ? 'true' : undefined}
                    className={cn(
                      'relative flex min-h-16 flex-col items-center justify-center gap-1 rounded-md border p-1 text-center outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50',
                      checked && 'border-primary bg-primary/10',
                    )}
                  >
                    <span aria-hidden className="pointer-events-none flex size-8 items-center justify-center" data-tile-art>
                      <Suspense fallback={<Loading size={28} />}>
                        <AnimatedIconArt name={name} animation={preview} size={28} stroke={stroke} color={color} trigger="view" playing={active === name && !still} />
                      </Suspense>
                    </span>
                    <span className="line-clamp-2 text-[11px] leading-tight">{title.en}</span>
                    {checked && <CheckIcon className="absolute top-1 right-1 size-3.5 text-primary" aria-hidden />}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>
      {names.length === 0 && <Note>No icons are available.</Note>}
      <FieldError id={`${legendId}-error`} message={error} />
    </fieldset>
  )
}

function ColorRoleField({ props, colors, onRole, onColor, error }: { props: AnimatedIconProps; colors?: Record<string, string>; onRole: (role: AnimatedIconProps['color_role']) => void; onColor: (hex: string) => void; error?: string }) {
  const legendId = useId()
  const custom = props.color_role === 'custom'
  const [hex, setHex] = useState(props.color ?? '')
  const [seen, setSeen] = useState(props.color)
  if (seen !== props.color) {
    setSeen(props.color)
    setHex(props.color ?? '')
  }
  const hint = custom ? iconContrastHint(props.color, colors) : null
  return (
    <fieldset className="flex flex-col gap-2" aria-describedby={error ? `${legendId}-error` : undefined}>
      <legend id={legendId} className="mb-1.5 text-sm font-medium">
        Colour
      </legend>
      <div role="group" aria-label="Colour" className="flex flex-wrap gap-1.5">
        {ICON_COLOR_ROLES.map((role) => {
          const active = props.color_role === role.value
          return (
            <Button key={role.value} type="button" size="sm" variant={active ? 'default' : 'outline'} aria-pressed={active} onClick={() => onRole(role.value)}>
              {role.value !== 'custom' && <span aria-hidden className="size-3.5 rounded-full border border-white/60" style={{ background: roleColor(role.value, colors) }} />}
              {role.label}
            </Button>
          )
        })}
      </div>
      {!custom && <p className="text-sm text-muted-foreground">Follows your theme: change the theme and the icon changes with it.</p>}
      {custom && (
        <div className="flex items-center gap-2">
          <input
            type="color"
            aria-label="Icon colour picker"
            value={/^#[0-9a-f]{6}$/i.test(hex) ? hex.toLowerCase() : '#000000'}
            onChange={(e) => {
              setHex(e.target.value)
              onColor(e.target.value.toLowerCase())
            }}
            className="h-9 w-11 shrink-0 cursor-pointer rounded-md border bg-transparent p-1"
          />
          <Input
            aria-label="Icon colour hex value"
            placeholder="#rrggbb"
            value={hex}
            maxLength={7}
            spellCheck={false}
            className="font-mono"
            aria-invalid={error ? true : undefined}
            onChange={(e) => {
              setHex(e.target.value)
              if (/^#[0-9a-f]{6}$/i.test(e.target.value)) onColor(e.target.value.toLowerCase())
            }}
          />
        </div>
      )}
      {hint && (
        <p role="status" className="flex items-start gap-1.5 text-sm text-amber-700 dark:text-amber-400" data-testid="icon-contrast-hint">
          <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>{hint.text}</span>
        </p>
      )}
      <FieldError id={`${legendId}-error`} message={error} />
    </fieldset>
  )
}

const TRIGGER_HINTS: Record<AnimatedIconProps['trigger'], string> = {
  view: 'It plays once as shoppers scroll to it.',
  hover: 'It plays when shoppers point at it, or at the button or link around it, and when they reach it with the keyboard.',
  loop: 'It keeps playing while it is on screen. Shoppers can stop it with the pause button. Use this for one or two icons at most.',
}

export function AnimatedIconForm(props: B20FormProps<AnimatedIconElement>) {
  const { node, onChange, errors, enums, theme } = props
  const p = node.props
  const colors = theme?.colors
  const [playKey, setPlayKey] = useState(0)
  const names = namesFrom(enums, 'animated_icon_names', ANIMATED_ICON_NAMES)
  const groups = iconGroups(enums, names, ICON_GROUPS)
  const keywords = iconKeywords(enums, ICON_KEYWORDS)
  const color = iconColor(p, colors)
  const set = (values: Partial<AnimatedIconProps>, key?: string) => patch(node, onChange, values, key)
  const replay = () => setPlayKey((k) => k + 1)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col items-center gap-2 rounded-md border bg-muted/30 p-3" data-testid="animated-icon-preview">
        <div className="flex h-28 items-center justify-center">
          <IconStage props={p} color={color} size={Math.min(p.size, 80)} playing={!prefersReducedMotion()} playKey={playKey} />
        </div>
        <Button type="button" size="sm" variant="ghost" onClick={replay} disabled={p.animation === 'none'}>
          <RotateCcwIcon aria-hidden /> Play again
        </Button>
      </div>
      <AnimatedIconPicker
        value={p.name}
        names={names}
        groups={groups}
        keywords={keywords}
        animation={p.animation}
        stroke={p.stroke}
        color={color}
        error={errors.name}
        onChange={(name) => {
          set({ name })
          replay()
        }}
      />
      <TileGroup<AnimatedIconAnimation>
        label="Animation"
        tooltip="How the icon moves. Shoppers who ask their device for less motion see it still."
        value={p.animation}
        columns={4}
        testId="animated-icon-animation"
        options={ICON_ANIMATIONS.map((a) => ({ value: a.value, label: a.label, title: `${a.label}: ${a.hint}` }))}
        onChange={(animation) => {
          set({ animation })
          replay()
        }}
        renderTile={(option, { active }) => <AnimationTile name={p.name} animation={option.value} stroke={p.stroke} color={color} active={active} />}
      />
      <FieldError message={errors.animation} />
      <ChoiceField label="When it plays" value={p.trigger} options={ICON_TRIGGERS} error={errors.trigger} hint={TRIGGER_HINTS[p.trigger]} onChange={(trigger) => set({ trigger })} />
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1.5 text-sm font-medium">Size</legend>
        <div role="group" aria-label="Quick sizes" className="flex flex-wrap gap-1.5">
          {ICON_SIZES.map((s) => (
            <Button key={s.value} type="button" size="sm" variant={p.size === s.value ? 'default' : 'outline'} aria-pressed={p.size === s.value} onClick={() => set({ size: s.value })}>
              {s.label}
            </Button>
          ))}
        </div>
        <PixelField label="Size in px" value={p.size} min={B20_LIMITS.iconSize.min} max={B20_LIMITS.iconSize.max} error={errors.size} onChange={(size) => set({ size }, 'size')} />
      </fieldset>
      <Segmented label="Line weight" value={p.stroke} options={ICON_STROKES} onChange={(stroke) => set({ stroke })} testId="animated-icon-stroke" />
      <FieldError message={errors.stroke} />
      <ColorRoleField
        props={p}
        colors={colors}
        error={errors.color ?? errors.color_role}
        onRole={(role) => onChange({ ...node, props: withColorRole(p, role, colors) })}
        onColor={(hex) => set({ color: hex }, 'color')}
      />
      <ChoiceField label="Background shape" value={p.background} options={ICON_BACKGROUNDS} error={errors.background} onChange={(background) => set({ background })} hint="A light shape in the icon’s colour behind it." />
      <Description
        {...props}
        field="label"
        value={p.label}
        start={iconTitle(p.name, keywords).en}
        label="Name for screen readers"
        switchLabel="Decorative (no label)"
        hint="What the icon means, e.g. “Free delivery”."
        max={limit('animated_icon', 'label')}
        error={errors.label}
      />
    </div>
  )
}

function AnimationTile({ name, animation, stroke, color, active }: { name: string; animation: AnimatedIconAnimation; stroke: number; color: string; active: boolean }) {
  return (
    <span aria-hidden className="pointer-events-none flex h-8 w-full items-center justify-center rounded-sm bg-muted/60" data-tile-art>
      <Suspense fallback={<Loading size={22} />}>
        <AnimatedIconArt name={name} animation={animation} size={22} stroke={stroke} color={color} trigger="view" playing={active && animation !== 'none' && !prefersReducedMotion()} />
      </Suspense>
    </span>
  )
}

/* ----------------------------------------------------------------------------------------------
 * Illustration
 * -------------------------------------------------------------------------------------------- */

export function IllustrationPicker({ value, names, labels, palette, colors, onChange, error }: {
  value: string
  colors?: Record<string, string>
  names: readonly string[]
  labels: ReturnType<typeof illustrationLabels>
  palette: IllustrationProps['palette']
  onChange: (name: string) => void
  error?: string
}) {
  const legendId = useId()
  const [active, setActive] = useState<string | null>(null)
  const still = prefersReducedMotion()
  return (
    <fieldset className="flex flex-col gap-2" aria-describedby={error ? `${legendId}-error` : undefined} data-testid="illustration-picker">
      <legend id={legendId} className="mb-1.5 text-sm font-medium">
        Illustration
      </legend>
      <div className="grid grid-cols-2 gap-1.5 p-0.5">
        {names.map((name) => {
          const checked = name === value
          const label = labels[name] ?? { en: humanize(name), bn: '' }
          return (
            <button
              key={name}
              type="button"
              aria-pressed={checked}
              aria-label={label.en}
              title={label.bn ? `${label.en} (${label.bn})` : label.en}
              onClick={() => onChange(name)}
              onPointerEnter={() => setActive(name)}
              onPointerLeave={() => setActive((a) => (a === name ? null : a))}
              onFocus={() => setActive(name)}
              onBlur={() => setActive((a) => (a === name ? null : a))}
              data-testid={`illustration-${name}`}
              data-playing={active === name && !still ? 'true' : undefined}
              className={cn(
                'relative flex flex-col items-center gap-1 rounded-md border p-1.5 text-center outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50',
                checked && 'border-primary bg-primary/10',
              )}
            >
              <span aria-hidden className="pointer-events-none flex h-20 w-full items-center justify-center overflow-hidden rounded-sm bg-muted/40" data-tile-art>
                <Thumb colors={colors}>
                  <IllustrationArt name={name} palette={palette} play="hover" playing={active === name && !still} className="h-full w-auto max-w-full" />
                </Thumb>
              </span>
              <span className="text-xs leading-tight">{label.en}</span>
              {label.bn && (
                <span lang="bn" className="text-[11px] leading-tight text-muted-foreground">
                  {label.bn}
                </span>
              )}
              {checked && <CheckIcon className="absolute top-1 right-1 size-3.5 text-primary" aria-hidden />}
            </button>
          )
        })}
      </div>
      <FieldError id={`${legendId}-error`} message={error} />
    </fieldset>
  )
}

/** A drawing scaled into a thumbnail box, in the shop's colours. */
function Thumb({ children, colors }: { children: ReactNode; colors?: Record<string, string> }) {
  return (
    <span className="flex h-full w-full items-center justify-center" style={themeVars(colors) as CSSProperties}>
      <Suspense fallback={<span className="block h-full w-full rounded-sm bg-muted" />}>{children}</Suspense>
    </span>
  )
}

const PLAY_HINTS: Record<IllustrationProps['play'], string> = {
  view: 'It plays once as shoppers scroll to it, then rests on its last picture.',
  hover: 'It plays when shoppers point at it.',
  loop: 'It keeps playing while it is on screen. Shoppers can stop it with the pause button. Avoid it at the top of the page: it slows the first screen.',
}

export function IllustrationForm(props: B20FormProps<IllustrationElement>) {
  const { node, onChange, errors, enums, theme } = props
  const p = node.props
  const [playKey, setPlayKey] = useState(0)
  const names = namesFrom(enums, 'illustration_names', ILLUSTRATION_NAMES)
  const labels = illustrationLabels(enums, ILLUSTRATION_LABELS)
  const set = (values: Partial<IllustrationProps>, key?: string) => patch(node, onChange, values, key)
  const replay = () => setPlayKey((k) => k + 1)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col items-center gap-2 rounded-md border bg-muted/30 p-3" data-testid="illustration-preview">
        <span aria-hidden className="block h-36 w-full">
          <Thumb colors={theme?.colors}>
            <IllustrationArt key={playKey} name={p.name} palette={p.palette} play="view" playing={!prefersReducedMotion()} className="h-full w-auto max-w-full" />
          </Thumb>
        </span>
        <Button type="button" size="sm" variant="ghost" onClick={replay}>
          <RotateCcwIcon aria-hidden /> Play again
        </Button>
      </div>
      <IllustrationPicker
        value={p.name}
        names={names}
        labels={labels}
        palette={p.palette}
        colors={theme?.colors}
        error={errors.name}
        onChange={(name) => {
          set({ name })
          replay()
        }}
      />
      <ChoiceField label="When it plays" value={p.play} options={ILLUSTRATION_PLAYS} error={errors.play} hint={PLAY_HINTS[p.play]} onChange={(play) => set({ play })} />
      <Segmented label="Size" value={p.size} options={ILLUSTRATION_SIZES} onChange={(size) => set({ size })} testId="illustration-size" />
      <FieldError message={errors.size} />
      <ChoiceField label="Position" value={p.align} options={B20_ALIGN} error={errors.align} onChange={(align) => set({ align })} />
      <Segmented
        label="Colours"
        value={p.palette}
        options={ILLUSTRATION_PALETTES.map((o) => ({ ...o, hint: o.value === 'theme' ? 'Several colours from your theme.' : 'Shades of your main colour.' }))}
        onChange={(palette) => set({ palette })}
        testId="illustration-palette"
      />
      <FieldError message={errors.palette} />
      <Description
        {...props}
        field="alt"
        value={p.alt}
        start={labels[p.name]?.en ?? humanize(p.name)}
        label="Description"
        switchLabel="Decorative (no description)"
        hint="What the picture shows, read aloud to shoppers who can’t see it."
        max={limit('illustration', 'alt')}
        multiline
        error={errors.alt}
      />
    </div>
  )
}

/* ---------------------------------------------------------------------------------------------- */

export function B20Form(props: B20FormProps<Element>) {
  const { node } = props
  if (node.type === 'animated_icon') return <AnimatedIconForm {...(props as unknown as B20FormProps<AnimatedIconElement>)} />
  if (node.type === 'illustration') return <IllustrationForm {...(props as unknown as B20FormProps<IllustrationElement>)} />
  return null
}

