import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useLocale } from '../../../i18n/locale'
import { isPieKind, type ChartModel } from './model'
import { FONT, layoutChart, type CartesianLayout, type PieLayout, type Stop } from './layout'
import { seriesVar, insideLabelVar } from './palette'
import { ChartLegend } from './legend'
import { legendItems } from './legend-items'
import { ChartTooltip } from './tooltip'
import { ChartDataTable } from './data-table'
import { TexturePatterns } from './texture'
import { textureVar } from './texture-ids'
import { useChartMessages } from './messages'
import './chart.css'

/*
 * The chart element's figure (lazy chunk): caption (title + description), legend for ≥ 2 series,
 * the drawing (SVG role="img"), a keyboard/pointer layer of focusable marks with one tooltip, and
 * the data table — always in the DOM for screen readers, visually toggled. Follows the dataviz
 * skill: one value axis, fixed-order categorical slots, thin marks, recessive grid, text in text
 * tokens, selective direct labels, texture for print / forced colours.
 */

export type ChartFigureProps = {
  /** The element id (`data-b`, where compiled styles find the element). */
  id: string
  model: ChartModel
  /** The dark set (the store runs light today; a `data-theme="dark"` ancestor also switches it). */
  mode?: 'light' | 'dark'
  /** Force the texture fill (otherwise print / forced colours only). */
  texture?: boolean
  /** Initial width before the container is measured (tests, server-less previews). */
  initialWidth?: number
}

export default function ChartFigure({ id, model, mode, texture = false, initialWidth = 640 }: ChartFigureProps) {
  const m = useChartMessages()
  const { formatNumber, digits } = useLocale()
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const wrapRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(initialWidth)
  const [tableOpen, setTableOpen] = useState(model.showTable)
  const [active, setActive] = useState<{ index: number; via: 'pointer' | 'focus' } | null>(null)
  const [rover, setRover] = useState(0)
  const pointRefs = useRef<(SVGElement | null)[]>([])

  // Responsive: the chart is laid out for its container's width (no horizontal scroll at 375 px).
  useLayoutEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const measure = () => {
      const w = Math.floor(el.getBoundingClientRect().width)
      if (w > 0) setWidth(w)
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // A tap outside the chart hides a tooltip opened by touch.
  const pointerOpen = active?.via === 'pointer'
  useEffect(() => {
    if (!pointerOpen) return
    const outside = (event: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) setActive(null)
    }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [pointerOpen])

  const layout = useMemo(() => layoutChart(model, { width, fmt: formatNumber, totalLabel: m.total }), [model, width, formatNumber, m.total])
  const stops = layout.stops
  const focusIndex = Math.min(rover, Math.max(0, stops.length - 1))
  const activeStop = active ? stops[active.index] : undefined
  const current: Current = active && activeStop ? { stop: activeStop, via: active.via } : null

  const ids = { title: `${uid}-title`, desc: `${uid}-desc`, summary: `${uid}-summary`, table: `${uid}-table`, tip: `${uid}-tip` }
  const legend = legendItems(model)
  const legendVisible = legend.length >= 2 && (model.showLegend || !layout.directIdentity)
  const kindName = m.kinds[model.requestedKind]
  const seriesCount = isPieKind(model.requestedKind) ? 1 : model.series.length

  const move = useCallback(
    (next: number) => {
      const index = Math.max(0, Math.min(stops.length - 1, next))
      setRover(index)
      setActive({ index, via: 'focus' })
      pointRefs.current[index]?.focus()
    },
    [stops.length],
  )

  const onKeyDown = (event: KeyboardEvent, index: number) => {
    const keys: Record<string, number> = { ArrowRight: index + 1, ArrowDown: index + 1, ArrowLeft: index - 1, ArrowUp: index - 1, Home: 0, End: stops.length - 1 }
    const next = keys[event.key]
    if (next !== undefined) {
      event.preventDefault()
      move(next)
    } else if (event.key === 'Escape') {
      setActive(null)
    }
  }

  return (
    <figure
      data-b={id}
      data-testid="builder-chart"
      data-kind={model.kind}
      data-mode={mode}
      data-texture={texture ? 'on' : undefined}
      className="b-chart sf-chart flex w-full min-w-0 flex-col gap-3"
    >
      {(model.title || model.description) && (
        <figcaption className="flex flex-col gap-1">
          {model.title && (
            <span id={ids.title} className="font-heading text-lg leading-snug font-bold text-[var(--viz-ink)]">
              {model.title}
            </span>
          )}
          {model.description && (
            <span id={ids.desc} className="text-sm leading-relaxed">
              {model.description}
            </span>
          )}
        </figcaption>
      )}
      <span id={ids.summary} className="sr-only">
        {digits(m.summary(kindName, seriesCount, model.labels.length))}
      </span>

      {legendVisible && <ChartLegend items={legend} uid={uid} />}

      <div
        ref={wrapRef}
        className="relative w-full min-w-0"
        // A mouse leaving the chart hides the tooltip; a tap keeps it until the next tap (touch pointers "leave" right after lifting).
        onPointerLeave={(e) => {
          if (e.pointerType === 'mouse') setActive((a) => (a?.via === 'pointer' ? null : a))
        }}
      >
        <svg
          role="img"
          aria-labelledby={[model.title ? ids.title : '', ids.summary].filter(Boolean).join(' ')}
          aria-describedby={model.description ? ids.desc : undefined}
          width={layout.width}
          height={layout.height}
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          className="block max-w-full"
          data-testid="chart-svg"
        >
          <TexturePatterns uid={uid} />
          {layout.type === 'pie' ? <PieDrawing layout={layout} uid={uid} current={current} /> : <CartesianDrawing layout={layout} uid={uid} current={current} />}
        </svg>

        {/* Keyboard + pointer layer: one tab stop, arrow keys move between marks; hit targets larger than the marks. */}
        <svg width={layout.width} height={layout.height} className="absolute top-0 left-0 max-w-full" data-testid="chart-points">
          <g role="group" aria-label={m.points} transform={layout.type === 'pie' ? `translate(${layout.cx},${layout.cy})` : undefined}>
            {stops.map((stop, i) => {
              const common = {
                ref: (el: SVGElement | null) => {
                  pointRefs.current[i] = el
                },
                className: 'viz-hit cursor-default',
                tabIndex: i === focusIndex ? 0 : -1,
                role: 'img' as const,
                'aria-label': digits(stop.ariaLabel),
                'data-stop': stop.key,
                fill: 'transparent',
                onPointerEnter: () => setActive({ index: i, via: 'pointer' }),
                onPointerDown: () => setActive({ index: i, via: 'pointer' }),
                onFocus: () => {
                  setRover(i)
                  setActive({ index: i, via: 'focus' })
                },
                onBlur: () => setActive((a) => (a?.index === i && a.via === 'focus' ? null : a)),
                onKeyDown: (e: KeyboardEvent) => onKeyDown(e, i),
              }
              return 'd' in stop.hit ? <path key={stop.key} {...common} d={stop.hit.d} /> : <rect key={stop.key} {...common} x={stop.hit.x} y={stop.hit.y} width={Math.max(0, stop.hit.w)} height={Math.max(0, stop.hit.h)} />
            })}
          </g>
        </svg>

        {current && <ChartTooltip id={ids.tip} stop={current.stop} layout={layout} />}
      </div>

      <div>
        <button
          type="button"
          className="inline-flex min-h-11 items-center gap-2 rounded-sf-button text-sm font-semibold text-[var(--viz-ink)] underline underline-offset-4 hover:no-underline"
          aria-expanded={tableOpen}
          aria-controls={ids.table}
          onClick={() => setTableOpen((v) => !v)}
          data-testid="chart-table-toggle"
        >
          {tableOpen ? m.hideTable : m.showTable}
        </button>
      </div>
      <ChartDataTable id={ids.table} model={model} visible={tableOpen} />
    </figure>
  )
}

type Current = { stop: Stop; via: 'pointer' | 'focus' } | null

function CartesianDrawing({ layout, uid, current }: { layout: CartesianLayout; uid: string; current: Current }) {
  const { plot } = layout
  const vertical = layout.orientation === 'vertical'
  const activeKey = current?.stop.key
  const activeLabel = current?.stop.labelIndex
  return (
    <g>
      {/* Recessive grid: solid 1 px hairlines one step off the surface. */}
      <g aria-hidden="true">
        {layout.ticks.map((t) =>
          vertical ? (
            <line key={t.value} className="viz-grid" x1={plot.x} x2={plot.x + plot.w} y1={crisp(t.pos)} y2={crisp(t.pos)} stroke="var(--viz-grid)" strokeWidth={1} shapeRendering="crispEdges" />
          ) : (
            <line key={t.value} className="viz-grid" x1={crisp(t.pos)} x2={crisp(t.pos)} y1={plot.y} y2={plot.y + plot.h} stroke="var(--viz-grid)" strokeWidth={1} shapeRendering="crispEdges" />
          ),
        )}
      </g>

      {/* Crosshair (line/area): a hairline that snaps to the hovered / focused x. */}
      {current?.stop.crosshairX !== undefined && (
        <line x1={crisp(current.stop.crosshairX)} x2={crisp(current.stop.crosshairX)} y1={plot.y} y2={plot.y + plot.h} stroke="var(--viz-axis)" strokeWidth={1} data-testid="chart-crosshair" />
      )}

      {layout.bars.map((bar) => (
        <path
          key={bar.key}
          d={bar.d}
          data-viz-mark="bar"
          data-fill=""
          data-active={bar.key === activeKey ? 'true' : undefined}
          style={{ fill: seriesVar(bar.slot), ['--viz-tex' as string]: textureVar(uid, bar.slot) }}
        />
      ))}

      {layout.lines.map((line) => (
        <g key={line.seriesIndex}>
          {line.areaD && <path d={line.areaD} data-viz-mark="area" style={{ fill: seriesVar(line.slot), fillOpacity: 0.1 }} />}
          <path d={line.d} data-viz-mark="line" data-stroke="" fill="none" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" style={{ stroke: seriesVar(line.slot) }} />
        </g>
      ))}
      {/* Markers ≥ 8 px with a 2 px surface ring; every point of the hovered x lifts. */}
      {layout.lines.map((line) => {
        const markers = activeLabel !== undefined && current?.stop.crosshairX !== undefined ? [...line.markers, ...line.points.filter((p) => p.labelIndex === activeLabel)] : line.markers
        return (
          <g key={`m-${line.seriesIndex}`}>
            {markers.map((p, i) => (
              <circle
                key={`${p.labelIndex}-${i}`}
                cx={p.x}
                cy={p.y}
                r={p.labelIndex === activeLabel && current?.stop.crosshairX !== undefined ? 5 : 4}
                strokeWidth={2}
                data-viz-mark="marker"
                style={{ fill: seriesVar(line.slot), stroke: 'var(--viz-surface)' }}
              />
            ))}
          </g>
        )
      })}

      {/* The one value axis's baseline (zero line). */}
      <line
        className="viz-axis"
        aria-hidden="true"
        x1={vertical ? plot.x : crisp(layout.baseline)}
        x2={vertical ? plot.x + plot.w : crisp(layout.baseline)}
        y1={vertical ? crisp(layout.baseline) : plot.y}
        y2={vertical ? crisp(layout.baseline) : plot.y + plot.h}
        stroke="var(--viz-axis)"
        strokeWidth={1}
        shapeRendering="crispEdges"
      />

      <g aria-hidden="true" fontSize={FONT} style={{ fill: 'var(--viz-ink-2)' }}>
        {layout.ticks.map((t) =>
          vertical ? (
            <text key={t.value} className="viz-tick" x={plot.x - 8} y={t.pos + FONT / 3} textAnchor="end">
              {t.text}
            </text>
          ) : (
            <text key={t.value} className="viz-tick" x={t.pos} y={plot.y + plot.h + 8 + FONT} textAnchor="middle">
              {t.text}
            </text>
          ),
        )}
        {layout.unitCaption && (
          <text x={vertical ? plot.x - 8 : plot.x + plot.w} y={plot.y - 10} textAnchor="end">
            {layout.unitCaption}
          </text>
        )}
        {layout.categories.map((c) => (
          <text
            key={c.index}
            x={c.x}
            y={c.y}
            textAnchor={c.anchor}
            dominantBaseline={c.rotate === 0 && vertical ? 'hanging' : undefined}
            transform={c.rotate ? `rotate(${c.rotate} ${c.x} ${c.y})` : undefined}
            data-testid="chart-category"
          >
            {c.text !== c.full && <title>{c.full}</title>}
            {c.text}
          </text>
        ))}
      </g>

      <g aria-hidden="true" fontSize={FONT}>
        {layout.valueLabels.map((v) => (
          <text key={v.key} x={v.x} y={v.y} textAnchor={v.anchor} fontWeight={600} style={{ fill: 'var(--viz-ink)' }} data-testid="chart-value-label">
            {v.text}
          </text>
        ))}
        {layout.endLabels.map((l) => (
          <text key={l.seriesIndex} x={l.x} y={l.y + FONT / 3} data-testid="chart-end-label">
            {l.full !== l.name && <title>{l.full}</title>}
            {l.value && (
              <tspan fontWeight={600} style={{ fill: 'var(--viz-ink)' }}>
                {l.value}
              </tspan>
            )}
            {l.name && (
              <tspan style={{ fill: 'var(--viz-ink-2)' }} {...(l.value ? { x: l.x, dy: FONT + 3 } : {})}>
                {l.name}
              </tspan>
            )}
          </text>
        ))}
      </g>

      {current?.via === 'focus' && <FocusRing stop={current.stop} />}
    </g>
  )
}

function PieDrawing({ layout, uid, current }: { layout: PieLayout; uid: string; current: Current }) {
  const activeKey = current?.stop.key
  return (
    <g>
      <g transform={`translate(${layout.cx},${layout.cy})`}>
        {layout.slices.map((s) => (
          <path
            key={s.key}
            d={s.d}
            data-viz-mark="slice"
            data-fill=""
            data-active={s.key === activeKey ? 'true' : undefined}
            style={{ fill: seriesVar(s.slot), ['--viz-tex' as string]: textureVar(uid, s.slot) }}
          />
        ))}
        {current?.via === 'focus' && <FocusRing stop={current.stop} />}
      </g>
      <g aria-hidden="true" fontSize={FONT}>
        {layout.valueLabels.map((v) => (
          <text key={v.key} x={v.x} y={v.y} textAnchor="middle" fontWeight={600} style={{ fill: v.inside ? insideLabelVar(v.inside.slot) : 'var(--viz-ink)' }} data-testid="chart-value-label">
            {v.text}
          </text>
        ))}
        {layout.center && (
          <>
            <text x={layout.cx} y={layout.cy - 2} textAnchor="middle" fontSize={20} fontWeight={700} style={{ fill: 'var(--viz-ink)' }} data-testid="chart-donut-total">
              {layout.center.value}
            </text>
            <text x={layout.cx} y={layout.cy + 20} textAnchor="middle" style={{ fill: 'var(--viz-ink-2)' }}>
              {layout.center.label}
            </text>
          </>
        )}
      </g>
    </g>
  )
}

/** The keyboard focus indicator around the focused mark (ink ring, 2 px). */
function FocusRing({ stop }: { stop: Stop }) {
  const f = stop.focus
  if (Array.isArray(f)) {
    return (
      <g data-testid="chart-focus-ring">
        {f.map((c, i) => (
          <circle key={i} cx={c.cx} cy={c.cy} r={c.r + 2} fill="none" strokeWidth={2} style={{ stroke: 'var(--viz-ink)' }} />
        ))}
      </g>
    )
  }
  if ('d' in f) return <path d={f.d} fill="none" strokeWidth={2} style={{ stroke: 'var(--viz-ink)' }} data-testid="chart-focus-ring" />
  return <rect x={f.x} y={f.y} width={Math.max(0, f.w)} height={Math.max(0, f.h)} rx={5} fill="none" strokeWidth={2} style={{ stroke: 'var(--viz-ink)' }} data-testid="chart-focus-ring" />
}

function crisp(v: number): number {
  return Math.round(v) + 0.5
}
