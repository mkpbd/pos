/*
 * The Style tab (B3): design controls for the selected node, grouped per node type (the most used
 * groups open, the rest collapsed). Everything edits the breakpoint of the toolbar's device
 * (Desktop = base) and writes the sparse `style.base|tablet|mobile`; each control shows whether
 * its value is set for this device or inherited, with a reset. Every write is checked against the
 * builder's validator first (validate.ts); a value it would drop is refused, never saved.
 */

import { useState, type ReactNode } from 'react'
import { ChevronRightIcon, MonitorIcon, SmartphoneIcon, TabletIcon } from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import type { Background, BackgroundParallax, BackgroundVideo, Breakpoint, HoverStyle, Column, Device, ResponsiveStyle, Shadow, Sides, Typography } from '@/storefront/builder/types'
import type { MediaRef } from '@/storefront/types'
import {
  BackgroundControl,
  BorderControl,
  ColorControl,
  HoverControl,
  LengthControl,
  Segmented,
  ShadowControl,
  SliderControl,
  SpacingBox,
  TypographyControl,
  type Border,
  type BorderKey,
  type Hover,
  type HoverKey,
  type PaletteColor,
  type SpacingBoxName,
  type TypographyKey,
} from '../controls'
import { HelpTip } from '../controls/control-label'
import { BackgroundVideoControl } from './b6-style'
import { MotionControl } from './b9-motion-control'
import { canParallax } from './b9-motion'
import { DeviceStatus } from './device-status'
import { GROUP_TIPS, GROUP_TITLES, groupsFor, type GroupId } from './style-groups'
import { BREAKPOINT, CASCADE, DEVICE_LABEL, effectiveGroup, getAt, resolveStyleValue, sameJson, styleIsValid, widthAt, writeStyleValue, type Resolved, type StylePath } from './style-model'
import type { BuilderNode, InspectorChangeOptions, InspectorCommand } from './types'

export type StyleTheme = { colors?: Record<string, string>; palette?: readonly PaletteColor[] }

const DEVICES: { device: Device; Icon: typeof MonitorIcon }[] = [
  { device: 'desktop', Icon: MonitorIcon },
  { device: 'tablet', Icon: TabletIcon },
  { device: 'mobile', Icon: SmartphoneIcon },
]

const BANNER: Record<Device, string> = {
  desktop: 'Changes apply on every device unless a tablet or mobile value is set.',
  tablet: 'Changes apply to tablets and phones only. Desktop values show through until you change them.',
  mobile: 'Changes apply to phones only. Desktop and tablet values show through until you change them.',
}

function DeviceBanner({ device, onDevice }: { device: Device; onDevice?: (device: Device) => void }) {
  const Icon = DEVICES.find((d) => d.device === device)!.Icon
  return (
    <div className="flex flex-col gap-2 rounded-md border border-primary/30 bg-primary/5 p-3" data-testid="style-device-banner">
      <div className="flex items-center gap-2">
        <Icon className="size-4 shrink-0 text-primary" aria-hidden />
        <p className="text-sm font-medium" role="status">Styling for {DEVICE_LABEL[device]}</p>
        {onDevice && (
          <div className="ml-auto flex gap-0.5" role="group" aria-label="Device to style">
            {DEVICES.map(({ device: d, Icon: DIcon }) => (
              <button
                key={d}
                type="button"
                aria-pressed={d === device}
                aria-label={`Style for ${DEVICE_LABEL[d]}`}
                title={`Style for ${DEVICE_LABEL[d]}`}
                onClick={() => onDevice(d)}
                className="flex size-6 items-center justify-center rounded text-muted-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring aria-pressed:bg-primary aria-pressed:text-primary-foreground [&_svg]:size-3.5"
              >
                <DIcon aria-hidden />
              </button>
            ))}
          </div>
        )}
      </div>
      <p className="text-xs text-muted-foreground">{BANNER[device]}</p>
    </div>
  )
}

function StyleGroup({ id, title, open, setHere, children }: { id: GroupId; title: string; open: boolean; setHere: boolean; children: ReactNode }) {
  const [expanded, setExpanded] = useState(open)
  const tip = GROUP_TIPS[id]
  return (
    <section className="border-b last:border-b-0" data-testid={`style-group-${id}`} aria-label={title}>
      <h3 className="flex items-center gap-1.5">
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
          className="flex flex-1 items-center gap-1.5 py-2.5 text-left text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronRightIcon className={cn('size-4 shrink-0 text-muted-foreground transition-transform', expanded && 'rotate-90')} aria-hidden />
          {title}
          {setHere && <span role="img" className="size-1.5 rounded-full bg-primary" aria-label="(has values for this device)" />}
        </button>
        {tip && <HelpTip label={title} text={tip} />}
      </h3>
      {expanded && <div className="flex flex-col gap-4 pb-4">{children}</div>}
    </section>
  )
}

/* ---------------------------------------------------------------------------------------------- */

type StyleTabProps = {
  node: BuilderNode
  device: Device
  onChange: (next: BuilderNode, opts?: InspectorChangeOptions) => void
  onCommand: (cmd: InspectorCommand) => void
  theme?: StyleTheme
}

const GROUP_PATHS: Record<GroupId, StylePath[]> = {
  background: [['background']],
  'button-colors': [['background'], ['color'], ['effects', 'hover', 'color'], ['effects', 'hover', 'background_color']],
  color: [['color']],
  typography: [['typography']],
  spacing: [['spacing']],
  size: [['size']],
  layout: [['layout']],
  border: [['border']],
  shadow: [['effects', 'shadow']],
  effects: [['effects', 'shadow'], ['effects', 'opacity']],
  'text-effects': [['effects', 'text_shadow'], ['effects', 'opacity'], ['effects', 'hover', 'color']],
  hover: [['effects', 'hover', 'transform'], ['effects', 'hover', 'shadow']],
  motion: [['motion'], ['hover'], ['background', 'parallax']],
  'background-video': [['background', 'video']],
}

export function StyleTab({ node, device, onChange, onCommand, theme }: StyleTabProps) {
  const bp = BREAKPOINT[device]
  const style: ResponsiveStyle = node.style ?? {}
  const [refused, setRefused] = useState<string | null>(null)
  const themeColors = theme?.colors
  const palette = theme?.palette

  /** Writes several paths at once (one undo step), after the validator check. */
  const setMany = (entries: [StylePath, unknown][], media?: Record<string, MediaRef>) => {
    let next = style
    for (const [path, value] of entries) next = writeStyleValue(next, bp, path, value)
    if (sameJson(next, style)) return
    if (!styleIsValid(next)) {
      setRefused('That value isn’t allowed here, so it wasn’t saved.')
      return
    }
    setRefused(null)
    const key = entries.map(([path]) => path.join('.')).join('+')
    onChange({ ...node, style: next } as BuilderNode, { coalesceKey: `${node.id}:style:${bp}:${key}`, ...(media ? { media } : {}) })
  }
  const set = (path: StylePath, value: unknown, media?: Record<string, MediaRef>) => setMany([[path, value]], media)
  /** B6: motion and the background video live on `base` only (the same on every device). */
  const setBase = (path: StylePath, value: unknown, media?: Record<string, MediaRef>) => {
    const next = writeStyleValue(style, 'base', path, value)
    if (sameJson(next, style)) return
    if (!styleIsValid(next)) {
      setRefused('That value isn’t allowed here, so it wasn’t saved.')
      return
    }
    setRefused(null)
    onChange({ ...node, style: next } as BuilderNode, { coalesceKey: `${node.id}:style:base:${path.join('.')}`, ...(media ? { media } : {}) })
  }
  const baseVideo = style.base?.background?.video
  const baseParallax = style.base?.background?.parallax
  /**
   * Writes the background at this breakpoint, keeping the desktop background video and (B9) the
   * parallax while the background is still a picture (the background controls know neither).
   */
  const setBackground = (bg: Background | undefined, media?: Record<string, MediaRef>) => {
    if (bp !== 'base' || (!baseVideo && !baseParallax)) return set(['background'], bg, media)
    const keep: Partial<Background> = {}
    if (baseVideo) keep.video = baseVideo
    if (baseParallax && bg?.type === 'image') keep.parallax = baseParallax
    if (!bg && !baseVideo) return set(['background'], undefined, media)
    set(['background'], bg ? { ...bg, ...keep } : { type: 'none', ...keep }, media)
  }
  /** B9: the section background picture's scrolling (desktop background, every device). */
  const setParallax = (parallax: BackgroundParallax | undefined) => {
    const current = style.base?.background
    if (!current || current.type !== 'image') return
    if (parallax) return setBase(['background'], { ...current, parallax })
    const { parallax: _old, ...rest } = current
    void _old
    setBase(['background'], rest)
  }
  const setVideo = (video: BackgroundVideo | undefined, media?: Record<string, MediaRef>) => {
    const current = style.base?.background
    if (video) return setBase(['background'], { ...(current ?? { type: 'none' }), video }, media)
    if (!current) return
    const { video: _old, ...rest } = current
    void _old
    // A background that only carried the video goes away with it.
    setBase(['background'], rest.type === 'none' && Object.keys(rest).length === 1 ? undefined : rest)
  }
  const get = <T,>(path: StylePath) => resolveStyleValue<T>(style, bp, path)
  const group = <T extends object>(path: StylePath) => effectiveGroup<T & Record<string, unknown>>(style, bp, path) as T

  /** The indicator + reset for a path. */
  const status = (path: StylePath, label: string) => {
    const resolved = get(path)
    // The breakpoint whose value shows through after a reset (the nearest wider one that sets it).
    const after = CASCADE[bp].slice(1).find((b) => getAt(style[b], path) !== undefined) ?? null
    return <DeviceStatus origin={resolved.origin} breakpoint={bp} label={label} inheritsFrom={after} onReset={() => set(path, undefined)} />
  }

  /** Writes only the keys of a group object that differ from what applies now (keeps the style sparse). */
  const setDiff = (path: StylePath, next: Record<string, unknown> | undefined, current: Record<string, unknown>) => {
    const keys = new Set([...Object.keys(current), ...Object.keys(next ?? {})])
    const entries: [StylePath, unknown][] = []
    for (const key of keys) {
      const value = next?.[key]
      if (!sameJson(value, current[key])) entries.push([[...path, key], value])
    }
    if (entries.length > 0) setMany(entries)
  }

  const setHere = (id: GroupId) => GROUP_PATHS[id].some((path) => resolveStyleValue(style, bp, path).origin.kind === 'here')

  const sections: Record<GroupId, () => ReactNode> = {
    background: () => (
      <BackgroundControl
        value={withoutVideo(get<Background>(['background']).value)}
        onChange={(bg, media) => setBackground(bg, media)}
        themeColors={themeColors}
        palette={palette}
        status={status(['background'], 'Background')}
        tooltip="A colour, gradient or picture behind this part of the page."
      />
    ),
    'button-colors': () => {
      const bg = get<Background>(['background']).value
      const hover = group<Hover>(['effects', 'hover'])
      return (
        <>
          <ColorControl
            label="Button colour"
            value={bg?.type === 'color' ? (bg.color ?? null) : null}
            onChange={(c) => set(['background'], c ? { type: 'color', color: c } : undefined)}
            themeColors={themeColors}
            palette={palette}
            allowTokens
            allowAlpha
            allowClear
            placeholder="From the button look"
            status={status(['background'], 'Button colour')}
          />
          <ColorControl
            label="Text colour"
            value={get<string>(['color']).value ?? null}
            onChange={(c) => set(['color'], c ?? undefined)}
            themeColors={themeColors}
            palette={palette}
            allowTokens
            allowAlpha
            allowClear
            placeholder="From the button look"
            contrastWith={bg?.type === 'color' ? bg.color : undefined}
            status={status(['color'], 'Text colour')}
          />
          <HoverControl
            value={hover}
            parts={['background_color', 'color']}
            onChange={(key, v) => set(['effects', 'hover', key], v)}
            statusFor={(key) => status(['effects', 'hover', key], key === 'color' ? 'Text colour on hover' : 'Background on hover')}
            themeColors={themeColors}
            palette={palette}
          />
        </>
      )
    },
    color: () => (
      <ColorControl
        label="Text colour"
        value={get<string>(['color']).value ?? null}
        onChange={(c) => set(['color'], c ?? undefined)}
        themeColors={themeColors}
        palette={palette}
        allowTokens
        allowAlpha
        allowClear
        placeholder="Theme default"
        status={status(['color'], 'Text colour')}
      />
    ),
    typography: () => (
      <TypographyControl
        value={group<Typography>(['typography'])}
        onChange={(key: TypographyKey, v: unknown) => set(['typography', key], v)}
        statusFor={(key) => status(['typography', key], TYPOGRAPHY_LABELS[key])}
      />
    ),
    spacing: () => (
      <SpacingBox
        value={{ margin: group<Sides>(['spacing', 'margin']), padding: group<Sides>(['spacing', 'padding']) }}
        onChange={(box: SpacingBoxName, sides) => setDiff(['spacing', box], sides, group<Sides>(['spacing', box]))}
        statusFor={(box) => status(['spacing', box], box === 'margin' ? 'Outer space' : 'Inner space')}
        placeholder="0"
      />
    ),
    size: () => <SizeGroup node={node} bp={bp} device={device} get={get} set={set} status={status} onCommand={onCommand} />,
    layout: () => <LayoutGroup node={node} get={get} set={set} status={status} />,
    border: () => {
      const border = group<Border>(['border'])
      return (
        <BorderControl
          value={{ ...border, radius: group<NonNullable<Border['radius']>>(['border', 'radius']) }}
          parts={node.type === 'image' ? ['radius', 'style', 'width', 'color'] : ['style', 'width', 'color', 'radius']}
          onChange={(key: BorderKey, v: unknown) => {
            if (key === 'radius') setDiff(['border', 'radius'], v as Record<string, unknown> | undefined, group(['border', 'radius']))
            else set(['border', key], v)
          }}
          statusFor={(key) => status(['border', key], BORDER_LABELS[key])}
          themeColors={themeColors}
          palette={palette}
        />
      )
    },
    shadow: () => (
      <ShadowControl label="Shadow" value={get<Shadow[]>(['effects', 'shadow']).value} onChange={(v) => set(['effects', 'shadow'], v)} themeColors={themeColors} palette={palette} status={status(['effects', 'shadow'], 'Shadow')} />
    ),
    effects: () => (
      <>
        {node.type !== 'image' && (
          <ShadowControl label="Shadow" value={get<Shadow[]>(['effects', 'shadow']).value} onChange={(v) => set(['effects', 'shadow'], v)} themeColors={themeColors} palette={palette} status={status(['effects', 'shadow'], 'Shadow')} />
        )}
        <OpacityControl value={get<number>(['effects', 'opacity']).value} onChange={(v) => set(['effects', 'opacity'], v)} status={status(['effects', 'opacity'], 'Opacity')} />
      </>
    ),
    'text-effects': () => (
      <>
        <ShadowControl text label="Text shadow" value={get<Shadow[]>(['effects', 'text_shadow']).value} onChange={(v) => set(['effects', 'text_shadow'], v)} themeColors={themeColors} palette={palette} status={status(['effects', 'text_shadow'], 'Text shadow')} />
        <OpacityControl value={get<number>(['effects', 'opacity']).value} onChange={(v) => set(['effects', 'opacity'], v)} status={status(['effects', 'opacity'], 'Opacity')} />
        <ColorControl
          label="Text colour on hover"
          value={get<string>(['effects', 'hover', 'color']).value ?? null}
          onChange={(c) => set(['effects', 'hover', 'color'], c ?? undefined)}
          themeColors={themeColors}
          palette={palette}
          allowTokens
          allowAlpha
          allowClear
          placeholder="No change"
          status={status(['effects', 'hover', 'color'], 'Text colour on hover')}
        />
      </>
    ),
    hover: () => (
      <HoverControl
        value={group<Hover>(['effects', 'hover'])}
        parts={['transform', 'shadow']}
        onChange={(key: HoverKey, v: unknown) => set(['effects', 'hover', key], v)}
        statusFor={(key) => status(['effects', 'hover', key], key === 'transform' ? 'Movement on hover' : 'Shadow on hover')}
        themeColors={themeColors}
        palette={palette}
      />
    ),
    motion: () => (
      <MotionControl
        nodeType={node.type}
        value={style.base?.motion}
        onChange={(motion) => setBase(['motion'], motion)}
        onPreview={() => onCommand({ type: 'preview-motion', nodeId: node.id })}
        hover={style.base?.hover}
        onHover={(hover: HoverStyle | undefined) => setBase(['hover'], hover)}
        parallax={canParallax(node.type) ? { value: baseParallax, available: style.base?.background?.type === 'image', onChange: setParallax } : undefined}
      />
    ),
    'background-video': () => (
      <>
        <BackgroundVideoControl value={baseVideo} onChange={setVideo} />
        {bp !== 'base' && <p className="text-xs text-muted-foreground">The background video is the same on every device (phones show its poster).</p>}
      </>
    ),
  }

  const groups = groupsFor(node)
  return (
    <div className="flex flex-col gap-3" data-testid="style-tab">
      <DeviceBanner device={device} onDevice={(d) => onCommand({ type: 'set-device', device: d })} />
      {refused && <p role="alert" className="text-sm text-destructive">{refused}</p>}
      {groups.length === 0 ? (
        <p className="text-sm text-muted-foreground">This element has no style settings.</p>
      ) : (
        <div>
          {groups.map((g) => (
            // Re-mounted per node so open/closed resets for each selection.
            <StyleGroup key={`${node.id}:${g.id}`} id={g.id} title={GROUP_TITLES[g.id]} open={g.open === true} setHere={setHere(g.id)}>
              {sections[g.id]()}
            </StyleGroup>
          ))}
        </div>
      )}
    </div>
  )
}

/** The background without the B6 video and the B9 parallax (edited in their own groups). */
function withoutVideo(bg: Background | undefined): Background | undefined {
  if (!bg?.video && !bg?.parallax) return bg
  const { video: _video, parallax: _parallax, ...rest } = bg
  void _video
  void _parallax
  return rest
}

const TYPOGRAPHY_LABELS: Record<TypographyKey, string> = {
  font: 'Font',
  size: 'Text size',
  weight: 'Weight',
  line_height: 'Line height',
  letter_spacing: 'Letter spacing',
  align: 'Alignment',
  transform: 'Capitals',
}

const BORDER_LABELS: Record<BorderKey, string> = { width: 'Line width', style: 'Line', color: 'Line colour', radius: 'Rounded corners' }

function OpacityControl({ value, onChange, status }: { value: number | undefined; onChange: (v: number) => void; status: ReactNode }) {
  return (
    <SliderControl
      label="Opacity"
      tooltip="100 % is solid; lower values let what is behind show through."
      value={value === undefined ? undefined : Math.round(value * 100)}
      placeholder={100}
      min={0}
      max={100}
      step={5}
      format={(n) => `${n} %`}
      onChange={(n) => onChange(Math.round(n) / 100)}
      status={status}
    />
  )
}

/* ---------------------------------------------------------------------------------------------- */

type Getter = <T>(path: StylePath) => Resolved<T>
type Setter = (path: StylePath, value: unknown) => void
type StatusFn = (path: StylePath, label: string) => ReactNode

const SIZE_FIELDS = [
  { key: 'width', label: 'Width', units: ['%', 'px', 'rem', 'vw'], tooltip: 'How wide it is. % is a share of the space around it.' },
  { key: 'max_width', label: 'Maximum width', units: ['px', '%', 'rem', 'vw'], tooltip: 'It never gets wider than this, even on big screens.' },
  { key: 'height', label: 'Height', units: ['px', 'rem', 'vh', '%'], tooltip: 'A fixed height. Leave empty to fit the content.' },
  { key: 'min_height', label: 'Minimum height', units: ['px', 'vh', 'rem'], tooltip: 'At least this tall; taller when the content needs it. vh = % of the screen height.' },
] as const

function SizeGroup({ node, bp, device, get, set, status, onCommand }: { node: BuilderNode; bp: Breakpoint; device: Device; get: Getter; set: Setter; status: StatusFn; onCommand: (cmd: InspectorCommand) => void }) {
  const fields = node.type === 'spacer' ? SIZE_FIELDS.filter((f) => f.key === 'height') : node.type === 'divider' ? SIZE_FIELDS.filter((f) => f.key === 'width' || f.key === 'max_width') : SIZE_FIELDS
  const widthValue = get<string>(['size', 'width'])
  // Full width inherited from a wider device can only be changed there (width has no "auto").
  const inheritedFull = widthValue.value === '100%' && widthValue.origin.kind === 'inherited'
  return (
    <>
      {node.type === 'column' && <ColumnWidthField column={node as Column} bp={bp} device={device} onCommand={onCommand} />}
      {node.type === 'button' && (
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <Switch id={`fill-${node.id}`} checked={widthValue.value === '100%'} disabled={inheritedFull} onCheckedChange={(on) => set(['size', 'width'], on ? '100%' : undefined)} />
            <label htmlFor={`fill-${node.id}`} className="text-sm">Fill the column width</label>
          </div>
          {inheritedFull && <p className="text-xs text-muted-foreground">Full width comes from a wider device; change it there.</p>}
        </div>
      )}
      {fields.map((f) => (
        <LengthControl
          key={f.key}
          label={f.label}
          tooltip={f.tooltip}
          value={get<string>(['size', f.key]).value}
          units={f.units}
          placeholder={f.key === 'height' && node.type === 'spacer' ? '24' : 'Auto'}
          slider={f.key === 'height' || f.key === 'min_height' ? { min: 0, max: 800, step: 8 } : undefined}
          onChange={(v) => set(['size', f.key], v)}
          status={status(['size', f.key], f.label)}
        />
      ))}
    </>
  )
}

/** A column's width on the device being styled (the keyboard alternative to the canvas's drag handles). */
function ColumnWidthField({ column, bp, device, onCommand }: { column: Column; bp: Breakpoint; device: Device; onCommand: (cmd: InspectorCommand) => void }) {
  const resolved = widthAt(column.width, bp)
  const after = CASCADE[bp].slice(1).find((b) => column.width[b] !== undefined) ?? null
  const [text, setText] = useState(String(resolved.value))
  const [seen, setSeen] = useState(resolved.value)
  const [error, setError] = useState<string | null>(null)
  if (seen !== resolved.value) {
    setSeen(resolved.value)
    setText(String(resolved.value))
    setError(null)
  }
  const commit = (raw: string) => {
    const n = Number(raw.replace(',', '.'))
    if (raw.trim() === '' || !Number.isFinite(n) || n < 5 || n > 100) return setError('Use 5 to 100 %.')
    setError(null)
    if (Math.round(n * 100) / 100 !== resolved.value) onCommand({ type: 'set-column-width', columnId: column.id, device, width: Math.round(n * 100) / 100 })
  }
  const label = `Column width on ${DEVICE_LABEL[device].toLowerCase()}`
  return (
    <div className="flex flex-col gap-1.5" data-testid="column-width-field">
      <div className="flex min-h-6 items-center gap-1.5">
        <label htmlFor={`width-${column.id}`} className="text-sm leading-none font-medium">{label}</label>
        <HelpTip label={label} text="A share of the row. Next to another column, that column gets the rest. 100 % puts the column on its own line. You can also drag the handles between columns on the page." />
        <span className="ml-auto flex items-center gap-1">
          <DeviceStatus
            origin={bp === 'base' ? { kind: 'default' } : resolved.origin}
            breakpoint={bp}
            label="Column width"
            inheritsFrom={after}
            onReset={() => onCommand({ type: 'set-column-width', columnId: column.id, device, width: null })}
          />
        </span>
      </div>
      <div className="flex items-center gap-2">
        <span className="flex items-center rounded-md border shadow-xs">
          <input
            id={`width-${column.id}`}
            type="text"
            inputMode="decimal"
            value={text}
            aria-invalid={error ? true : undefined}
            onChange={(e) => setText(e.target.value)}
            onBlur={() => commit(text)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit(text)
              if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                e.preventDefault()
                const next = Math.min(100, Math.max(5, (Number(text) || 0) + (e.key === 'ArrowUp' ? 5 : -5)))
                setText(String(next))
                commit(String(next))
              }
            }}
            className="h-8 w-16 bg-transparent px-2 text-sm tabular-nums outline-none"
          />
          <span className="pr-2 text-sm text-muted-foreground">%</span>
        </span>
        <button
          type="button"
          onClick={() => onCommand({ type: 'set-column-width', columnId: column.id, device, width: 100 })}
          className="h-8 rounded-md border px-2 text-xs outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
        >
          Full row
        </button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}

function LayoutGroup({ node, get, set, status }: { node: BuilderNode; get: Getter; set: Setter; status: StatusFn }) {
  const isColumn = node.type === 'column'
  return (
    <>
      <LengthControl
        label={isColumn ? 'Space between elements' : 'Space between columns'}
        value={get<string>(['layout', 'gap']).value}
        units={['px', 'rem']}
        placeholder={isColumn ? '16' : '24'}
        slider={{ min: 0, max: 96, step: 4 }}
        onChange={(v) => set(['layout', 'gap'], v)}
        status={status(['layout', 'gap'], isColumn ? 'Space between elements' : 'Space between columns')}
      />
      {!isColumn && (
        <LengthControl
          label="Space between lines"
          tooltip="When columns wrap onto a new line (on smaller screens), the space between the lines."
          value={get<string>(['layout', 'row_gap']).value}
          units={['px', 'rem']}
          placeholder="24"
          onChange={(v) => set(['layout', 'row_gap'], v)}
          status={status(['layout', 'row_gap'], 'Space between lines')}
        />
      )}
      <Segmented
        label={isColumn ? 'Line up elements' : 'Line up columns'}
        tooltip={isColumn ? 'Left, centre or right within the column, or stretched to its full width.' : 'Top, middle or bottom when the columns have different heights.'}
        value={get<'start' | 'center' | 'end' | 'stretch'>(['layout', 'align']).value}
        options={
          isColumn
            ? [{ value: 'start', label: 'Left' }, { value: 'center', label: 'Centre' }, { value: 'end', label: 'Right' }, { value: 'stretch', label: 'Stretch' }]
            : [{ value: 'start', label: 'Top' }, { value: 'center', label: 'Middle' }, { value: 'end', label: 'Bottom' }, { value: 'stretch', label: 'Stretch' }]
        }
        onChange={(v) => set(['layout', 'align'], v)}
        status={status(['layout', 'align'], isColumn ? 'Line up elements' : 'Line up columns')}
      />
      <Segmented
        label={isColumn ? 'Spread vertically' : 'Spread across'}
        tooltip={isColumn ? 'Where the elements sit when the column is taller than they are.' : 'Where the columns sit when they don’t fill the row.'}
        value={get<'start' | 'center' | 'end' | 'between' | 'around'>(['layout', 'justify']).value}
        options={[
          { value: 'start', label: 'Start', title: isColumn ? 'Top' : 'Left' },
          { value: 'center', label: 'Centre', title: 'Centre' },
          { value: 'end', label: 'End', title: isColumn ? 'Bottom' : 'Right' },
          { value: 'between', label: '↔', title: 'Space between' },
          { value: 'around', label: '⇹', title: 'Space around' },
        ]}
        onChange={(v) => set(['layout', 'justify'], v)}
        status={status(['layout', 'justify'], isColumn ? 'Spread vertically' : 'Spread across')}
      />
      {!isColumn && (
        <div className="flex items-center gap-2">
          <Switch id={`wrap-${node.id}`} checked={get<boolean>(['layout', 'wrap']).value ?? true} onCheckedChange={(wrap) => set(['layout', 'wrap'], wrap)} />
          <label htmlFor={`wrap-${node.id}`} className="text-sm">Let columns wrap onto a new line</label>
          <span className="ml-auto flex items-center gap-1">{status(['layout', 'wrap'], 'Wrap columns')}</span>
        </div>
      )}
    </>
  )
}
