/*
 * B12: the inspector with several items selected — "Common style" (contract §1) and Line up:
 * Align, Equal spacing and Same width (§3). Every field writes to all selected items for the
 * device being styled, as one undo step (`onChangeMany`). A field the items disagree on shows
 * "Mixed" (empty until you choose a value, which then goes to all of them).
 */

import { useId, useState, type ReactNode } from 'react'
import { AlignCenterIcon, AlignLeftIcon, AlignRightIcon, ChevronRightIcon, LayersIcon, RotateCcwIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { Background, Device, Shadow, Sides, Typography } from '@/storefront/builder/types'
import type { MediaRef } from '@/storefront/types'
import { BackgroundControl, BorderControl, ColorControl, LengthControl, Segmented, ShadowControl, SpacingBox, TypographyControl, type Border, type BorderKey, type LengthUnit, type SpacingBoxName, type TypographyKey } from '../controls'
import { NOT_SIBLINGS_REASON, siblingGroup } from '../selection'
import { ALIGN_LABELS, alignBlocks, alignText, blockAlignOf, blockAlignTargets, canEqualSpacing, equalSpacing, sameWidth, sameWidthPlan, suggestedSpacing, textAlignTargets, type TextAlign } from './arrange'
import { COMMON_PART_TITLES, commonGroup, commonParts, commonSizeFields, commonValue, resetForAll, writeToAll, type CommonPart, type CommonValue, type SizeKey, type WriteResult } from './common-style'
import { BREAKPOINT, DEVICE_LABEL, sameJson, type StylePath } from './style-model'
import { DeviceBanner, OpacityControl, type StyleTheme } from './style-tab'
import type { BuilderContent, BuilderNode, InspectorChangeOptions, InspectorCommand } from './types'

export type MultiInspectorProps = {
  content: BuilderContent
  /** The selected items (2+), in page order. */
  nodes: BuilderNode[]
  /** The item picked last (Same width copies its width). */
  primaryId: string | null
  device: Device
  theme?: StyleTheme
  labelOf: (node: BuilderNode) => string
  onChangeMany: (next: BuilderNode[], opts?: InspectorChangeOptions) => void
  onCommand: (cmd: InspectorCommand) => void
}

const SIZE_LABELS: Record<SizeKey, { label: string; units: LengthUnit[] }> = {
  width: { label: 'Width', units: ['%', 'px', 'rem', 'vw'] },
  max_width: { label: 'Maximum width', units: ['px', '%', 'rem', 'vw'] },
  height: { label: 'Height', units: ['px', 'rem', 'vh', '%'] },
  min_height: { label: 'Minimum height', units: ['px', 'vh', 'rem'] },
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

/** "Mixed" and a reset for all items (when any sets the value for this device). */
function MixedStatus({ common, label, device, onReset }: { common: Pick<CommonValue, 'mixed' | 'setHere'>; label: string; device: Device; onReset: () => void }) {
  return (
    <>
      {common.mixed && (
        <span data-status="mixed" role="img" aria-label={`${label}: the selected items differ`} title="The selected items have different values. A new value goes to all of them." className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] leading-none font-medium text-amber-900 dark:bg-amber-900/40 dark:text-amber-100">
          Mixed
        </span>
      )}
      {common.setHere > 0 && (
        <button
          type="button"
          aria-label={`Reset ${label} on ${DEVICE_LABEL[device].toLowerCase()} for all selected items`}
          title={`Reset for all selected items (${DEVICE_LABEL[device]})`}
          onClick={onReset}
          className="flex size-5 items-center justify-center rounded text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-3"
        >
          <RotateCcwIcon aria-hidden />
        </button>
      )}
    </>
  )
}

function Group({ id, title, children, open: initial = true }: { id: string; title: string; children: ReactNode; open?: boolean }) {
  const [open, setOpen] = useState(initial)
  return (
    <section className="border-b last:border-b-0" data-testid={`common-group-${id}`} aria-label={title}>
      <h3>
        <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="flex w-full items-center gap-1.5 py-2.5 text-left text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <ChevronRightIcon className={cn('size-4 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none', open && 'rotate-90')} aria-hidden />
          {title}
        </button>
      </h3>
      {open && <div className="flex flex-col gap-4 pb-4">{children}</div>}
    </section>
  )
}

export function MultiInspector({ content, nodes, primaryId, device, theme, labelOf, onChangeMany, onCommand }: MultiInspectorProps) {
  const bp = BREAKPOINT[device]
  const [message, setMessage] = useState<string | null>(null)
  const ids = nodes.map((n) => n.id)
  const themeColors = theme?.colors
  const palette = theme?.palette

  const commit = (result: WriteResult | null, key: string, media?: Record<string, MediaRef>) => {
    if (!result) return
    if (!result.ok) return setMessage('That value isn’t allowed for one of the selected items, so nothing was changed.')
    setMessage(null)
    if (result.nodes.length > 0) onChangeMany(result.nodes, { coalesceKey: `multi:${ids.join(',')}:${bp}:${key}`, ...(media ? { media } : {}) })
  }
  const write = (entries: [StylePath, unknown][], media?: Record<string, MediaRef>) => commit(writeToAll(nodes, bp, entries), entries.map(([p]) => p.join('.')).join('+'), media)
  const set = (path: StylePath, value: unknown) => write([[path, value]])
  const status = (path: StylePath, label: string) => <MixedStatus common={commonValue(nodes, bp, path)} label={label} device={device} onReset={() => commit(resetForAll(nodes, bp, path), `reset:${path.join('.')}`)} />
  const groupStatus = (path: StylePath, label: string, mixed: boolean) => {
    const c = commonValue(nodes, bp, path)
    return <MixedStatus common={{ mixed: mixed || c.mixed, setHere: c.setHere }} label={label} device={device} onReset={() => commit(resetForAll(nodes, bp, path), `reset:${path.join('.')}`)} />
  }
  /** Writes only the keys of a group that changed from the shared value (mixed keys stay as they are). */
  const setDiff = (path: StylePath, next: Record<string, unknown> | undefined, current: Record<string, unknown>) => {
    const keys = new Set([...Object.keys(current), ...Object.keys(next ?? {})])
    const entries: [StylePath, unknown][] = []
    for (const key of keys) if (!sameJson(next?.[key], current[key])) entries.push([[...path, key], next?.[key]])
    if (entries.length > 0) write(entries)
  }

  const parts = commonParts(nodes)
  const kinds = new Set(nodes.map((n) => labelOf(n)))

  const sections: Record<CommonPart, () => ReactNode> = {
    typography: () => {
      const g = commonGroup<Typography>(nodes, bp, ['typography'])
      return (
        <TypographyControl
          value={g.value}
          onChange={(key: TypographyKey, v: unknown) => set(['typography', key], v)}
          statusFor={(key) => groupStatus(['typography', key], TYPOGRAPHY_LABELS[key], g.mixed.has(key))}
        />
      )
    },
    color: () => {
      const c = commonValue<string>(nodes, bp, ['color'])
      return (
        <ColorControl
          label="Text colour"
          value={c.value ?? null}
          onChange={(v) => set(['color'], v ?? undefined)}
          themeColors={themeColors}
          palette={palette}
          allowTokens
          allowAlpha
          allowClear
          placeholder={c.mixed ? 'Mixed' : 'Theme default'}
          status={status(['color'], 'Text colour')}
        />
      )
    },
    spacing: () => {
      const margin = commonGroup<Sides>(nodes, bp, ['spacing', 'margin'])
      const padding = commonGroup<Sides>(nodes, bp, ['spacing', 'padding'])
      const of = (box: SpacingBoxName) => (box === 'margin' ? margin : padding)
      return (
        <SpacingBox
          value={{ margin: margin.value, padding: padding.value }}
          onChange={(box, sides) => setDiff(['spacing', box], sides as Record<string, unknown> | undefined, of(box).value as Record<string, unknown>)}
          statusFor={(box) => groupStatus(['spacing', box], box === 'margin' ? 'Outer space' : 'Inner space', of(box).mixed.size > 0)}
          placeholder="0"
        />
      )
    },
    size: () => (
      <>
        {commonSizeFields(nodes).map((key) => {
          const c = commonValue<string>(nodes, bp, ['size', key])
          return (
            <LengthControl
              key={key}
              label={SIZE_LABELS[key].label}
              value={c.value}
              units={SIZE_LABELS[key].units}
              placeholder={c.mixed ? 'Mixed' : 'Auto'}
              onChange={(v) => set(['size', key], v)}
              status={status(['size', key], SIZE_LABELS[key].label)}
            />
          )
        })}
      </>
    ),
    layout: () => {
      const isColumn = nodes[0]?.type === 'column'
      const gap = commonValue<string>(nodes, bp, ['layout', 'gap'])
      const align = commonValue<'start' | 'center' | 'end' | 'stretch'>(nodes, bp, ['layout', 'align'])
      return (
        <>
          <LengthControl
            label={isColumn ? 'Space between elements' : 'Space between columns'}
            value={gap.value}
            units={['px', 'rem']}
            placeholder={gap.mixed ? 'Mixed' : isColumn ? '16' : '24'}
            slider={{ min: 0, max: 96, step: 4 }}
            onChange={(v) => set(['layout', 'gap'], v)}
            status={status(['layout', 'gap'], isColumn ? 'Space between elements' : 'Space between columns')}
          />
          <Segmented
            label={isColumn ? 'Line up elements' : 'Line up columns'}
            value={align.value}
            options={
              isColumn
                ? [{ value: 'start', label: 'Left' }, { value: 'center', label: 'Centre' }, { value: 'end', label: 'Right' }, { value: 'stretch', label: 'Stretch' }]
                : [{ value: 'start', label: 'Top' }, { value: 'center', label: 'Middle' }, { value: 'end', label: 'Bottom' }, { value: 'stretch', label: 'Stretch' }]
            }
            onChange={(v) => set(['layout', 'align'], v)}
            status={status(['layout', 'align'], isColumn ? 'Line up elements' : 'Line up columns')}
          />
        </>
      )
    },
    background: () => {
      const c = commonValue<Background>(nodes, bp, ['background'])
      return (
        <BackgroundControl
          value={c.value}
          onChange={(bg, media) => write([[['background'], bg]], media)}
          themeColors={themeColors}
          palette={palette}
          status={status(['background'], 'Background')}
          tooltip="A colour, gradient or picture behind each selected item."
        />
      )
    },
    border: () => {
      const border = commonGroup<Border>(nodes, bp, ['border'])
      const radius = commonGroup<NonNullable<Border['radius']>>(nodes, bp, ['border', 'radius'])
      return (
        <BorderControl
          value={{ ...border.value, radius: radius.value }}
          onChange={(key: BorderKey, v: unknown) => {
            if (key === 'radius') setDiff(['border', 'radius'], v as Record<string, unknown> | undefined, radius.value as Record<string, unknown>)
            else set(['border', key], v)
          }}
          statusFor={(key) => groupStatus(['border', key], BORDER_LABELS[key], key === 'radius' ? radius.mixed.size > 0 : border.mixed.has(key))}
          themeColors={themeColors}
          palette={palette}
        />
      )
    },
    shadow: () => (
      <ShadowControl label="Shadow" value={commonValue<Shadow[]>(nodes, bp, ['effects', 'shadow']).value} onChange={(v) => set(['effects', 'shadow'], v)} themeColors={themeColors} palette={palette} status={status(['effects', 'shadow'], 'Shadow')} />
    ),
    opacity: () => <OpacityControl value={commonValue<number>(nodes, bp, ['effects', 'opacity']).value} onChange={(v) => set(['effects', 'opacity'], v)} status={status(['effects', 'opacity'], 'Opacity')} />,
  }

  return (
    <aside aria-label="Inspector" className="flex min-h-0 flex-col overflow-y-auto" data-testid="multi-inspector">
      <header className="flex items-center gap-2 border-b px-4 py-3">
        <LayersIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <h2 className="min-w-0 flex-1 truncate text-base font-semibold">{nodes.length} selected</h2>
      </header>
      <div className="flex flex-col gap-4 px-4 pt-3 pb-6">
        <p className="text-sm text-muted-foreground">
          {[...kinds].join(', ')}. Changes here go to all of them. To edit one item’s content, select only that item.
        </p>
        <DeviceBanner device={device} onDevice={(d) => onCommand({ type: 'set-device', device: d })} />
        {message && (
          <p role="alert" className="text-sm text-destructive">
            {message}
          </p>
        )}
        <LineUp content={content} nodes={nodes} primaryId={primaryId} device={device} commit={commit} />
        <div>
          <h3 className="pb-1 text-sm font-semibold">Common style</h3>
          {parts.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="common-style-none">
              These items have no style settings in common. Select items of the same kind to style them together.
            </p>
          ) : (
            <div data-testid="common-style">
              {parts.map((part, i) => (
                <Group key={`${ids.join(',')}:${part}`} id={part} title={COMMON_PART_TITLES[part]} open={i < 3}>
                  {sections[part]()}
                </Group>
              ))}
            </div>
          )}
        </div>
      </div>
    </aside>
  )
}

/* ------------------------------------------------------------------------------- Line up ---- */

const ALIGN_ICONS: Record<TextAlign, typeof AlignLeftIcon> = { left: AlignLeftIcon, center: AlignCenterIcon, right: AlignRightIcon }

function AlignButtons({ label, current, onPick, testId }: { label: string; current: TextAlign | null; onPick: (align: TextAlign) => void; testId: string }) {
  return (
    <div className="flex items-center gap-2" role="group" aria-label={label} data-testid={testId}>
      <span className="min-w-0 flex-1 text-sm">{label}</span>
      {(['left', 'center', 'right'] as const).map((align) => {
        const Icon = ALIGN_ICONS[align]
        return (
          <Button key={align} type="button" variant="outline" size="icon-sm" aria-label={`${label}: ${ALIGN_LABELS[align]}`} title={ALIGN_LABELS[align]} aria-pressed={current === align} onClick={() => onPick(align)} className="aria-pressed:border-primary aria-pressed:text-primary">
            <Icon aria-hidden />
          </Button>
        )
      })}
    </div>
  )
}

function LineUp({ content, nodes, primaryId, device, commit }: {
  content: BuilderContent
  nodes: BuilderNode[]
  primaryId: string | null
  device: Device
  commit: (result: WriteResult | null, key: string) => void
}) {
  const bp = BREAKPOINT[device]
  const fieldId = useId()
  const ids = nodes.map((n) => n.id)
  const group = siblingGroup(content, ids)
  const [spacing, setSpacing] = useState<string>(() => String(suggestedSpacing(nodes, bp)))
  const [spacingError, setSpacingError] = useState<string | null>(null)

  if (!group) {
    return (
      <section aria-label="Line up" className="rounded-md border p-3" data-testid="line-up">
        <h3 className="text-sm font-semibold">Line up</h3>
        <p className="mt-1 text-sm text-muted-foreground">{NOT_SIBLINGS_REASON}</p>
      </section>
    )
  }

  const text = textAlignTargets(nodes)
  const blocks = blockAlignTargets(nodes)
  const commonText = text.length > 0 ? commonValue<TextAlign>(text, bp, ['typography', 'align']) : null
  const blockAligns = blocks.map((n) => blockAlignOf(n, bp))
  const commonBlock = blockAligns.length > 0 && blockAligns.every((a) => a === blockAligns[0]) ? blockAligns[0]! : null
  const plan = sameWidthPlan(nodes, bp, primaryId)
  const where = DEVICE_LABEL[device].toLowerCase()

  const applySpacing = () => {
    const n = Number(spacing.replace(',', '.'))
    if (spacing.trim() === '' || !Number.isFinite(n) || n < 0 || n > 400) return setSpacingError('Use 0 to 400 px.')
    setSpacingError(null)
    commit(equalSpacing(nodes, bp, n), `equal-spacing:${n}`)
  }

  return (
    <section aria-label="Line up" className="flex flex-col gap-3 rounded-md border p-3" data-testid="line-up">
      <div>
        <h3 className="text-sm font-semibold">Line up</h3>
        <p className="text-xs text-muted-foreground">For {where}. Each button is one step you can undo.</p>
      </div>
      {commonText && <AlignButtons label="Align text" current={commonText.mixed ? null : (commonText.value ?? null)} onPick={(a) => commit(alignText(nodes, bp, a), `align-text:${a}`)} testId="align-text" />}
      {blocks.length > 0 && <AlignButtons label={blocks.length === nodes.length ? 'Place blocks' : `Place blocks (${blocks.length} of ${nodes.length})`} current={commonBlock} onPick={(a) => commit(alignBlocks(nodes, bp, a), `align-blocks:${a}`)} testId="align-blocks" />}
      {canEqualSpacing(nodes) && (
        <div className="flex flex-col gap-1" data-testid="equal-spacing">
          <label htmlFor={fieldId} className="text-sm">Equal space between them</label>
          <div className="flex items-center gap-2">
            <span className="flex items-center rounded-md border shadow-xs">
              <input
                id={fieldId}
                type="text"
                inputMode="numeric"
                value={spacing}
                aria-invalid={spacingError ? true : undefined}
                aria-describedby={spacingError ? `${fieldId}-error` : undefined}
                onChange={(e) => setSpacing(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    applySpacing()
                  }
                }}
                className="h-8 w-16 bg-transparent px-2 text-sm tabular-nums outline-none"
              />
              <span className="pr-2 text-sm text-muted-foreground">px</span>
            </span>
            <Button type="button" variant="outline" size="sm" onClick={applySpacing}>
              Apply
            </Button>
          </div>
          {spacingError && (
            <p id={`${fieldId}-error`} className="text-xs text-destructive">
              {spacingError}
            </p>
          )}
        </div>
      )}
      <div className="flex flex-col gap-1" data-testid="same-width">
        <Button type="button" variant="outline" size="sm" className="self-start" disabled={plan.kind === 'none'} aria-describedby={`${fieldId}-width`} onClick={() => commit(sameWidth(nodes, bp, primaryId), 'same-width')}>
          Same width
        </Button>
        <p id={`${fieldId}-width`} className="text-xs text-muted-foreground">
          {plan.kind === 'none' ? plan.reason : plan.kind === 'columns' ? `Each column gets ${plan.widths[0]} % of the row.` : `All get the width ${plan.width}.`}
        </p>
      </div>
    </section>
  )
}
