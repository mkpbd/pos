import { useId, type ReactNode } from 'react'
import { RotateCcwIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import {
  DEFAULT_PRODUCT_LAYOUT,
  describeProductLayout,
  isDefaultProductLayout,
  normalizeProductLayout,
  PRODUCT_LAYOUT_LABELS,
  PRODUCT_LAYOUT_OPTIONS,
  type ProductDetailsStyle,
  type ProductGallerySide,
  type ProductLayout,
  type ProductThumbnails,
} from './product-layout'

export type ProductLayoutFieldsProps = {
  /** The theme's `layout.product` (missing keys read as today's look). */
  value: ProductLayout | null | undefined
  onChange(next: ProductLayout): void
  disabled?: boolean
  /** Messages by key (`gallery`, `thumbnails`, `sticky_summary`, `details`). */
  errors?: Partial<Record<keyof ProductLayout, string | undefined>>
  /** `page`: a card (the Theme page); `drawer`: a stacked group (the builder's Site styles panel). */
  variant?: 'page' | 'drawer'
}

const TITLE = 'Product page'
const DESCRIPTION = 'How every product page is arranged on computers and tablets. Phones always show the photos first, then the details.'

/**
 * P1b: the product page layout (theme `layout.product`) — photos left or right, small photos under
 * or beside the main photo, a buy box that stays in view, and how the details are shown. Value in,
 * value out: the Theme page saves it with the theme draft; the Site styles panel autosaves it.
 */
export function ProductLayoutFields({ value, onChange, disabled = false, errors = {}, variant = 'page' }: ProductLayoutFieldsProps) {
  const layout = normalizeProductLayout(value)
  const ids = useId()
  const set = (patch: Partial<ProductLayout>) => onChange({ ...layout, ...patch })
  const reset = !disabled && !isDefaultProductLayout(layout) && (
    <Button type="button" variant="ghost" size="sm" onClick={() => onChange({ ...DEFAULT_PRODUCT_LAYOUT })}>
      <RotateCcwIcon data-icon="inline-start" /> Use the standard layout
    </Button>
  )

  const body = (
    <div className={cn('grid gap-5', variant === 'page' && 'lg:grid-cols-[minmax(0,1fr)_16rem]')} data-testid="product-layout">
      <div className="flex flex-col gap-5">
        <ChoiceGroup
          name={`${ids}-gallery`}
          legend="Photos"
          value={layout.gallery}
          options={PRODUCT_LAYOUT_OPTIONS.gallery}
          label={(o) => PRODUCT_LAYOUT_LABELS.gallery[o]}
          diagram={(o) => <GalleryDiagram side={o} />}
          onChange={(gallery) => set({ gallery })}
          disabled={disabled}
          error={errors.gallery}
        />
        <ChoiceGroup
          name={`${ids}-thumbnails`}
          legend="Small photos"
          hint="Phones always show them under the photo."
          value={layout.thumbnails}
          options={PRODUCT_LAYOUT_OPTIONS.thumbnails}
          label={(o) => PRODUCT_LAYOUT_LABELS.thumbnails[o]}
          diagram={(o) => <ThumbnailsDiagram place={o} />}
          onChange={(thumbnails) => set({ thumbnails })}
          disabled={disabled}
          error={errors.thumbnails}
        />
        <div className="flex flex-col gap-1">
          <div className="flex items-start gap-3 rounded-md border p-3">
            <Switch id={`${ids}-sticky`} checked={layout.sticky_summary} onCheckedChange={(sticky_summary) => set({ sticky_summary })} disabled={disabled} aria-describedby={`${ids}-sticky-hint`} aria-invalid={errors.sticky_summary ? true : undefined} />
            <div className="flex flex-col gap-0.5">
              <Label htmlFor={`${ids}-sticky`}>Keep the price and Add to cart in view</Label>
              <p id={`${ids}-sticky-hint`} className="text-xs text-muted-foreground">While shoppers scroll through the photos on a computer, the name, price and Add to cart button stay on screen.</p>
            </div>
          </div>
          {errors.sticky_summary && <p className="text-sm text-destructive">{errors.sticky_summary}</p>}
        </div>
        <ChoiceGroup
          name={`${ids}-details`}
          legend="Description, specifications and reviews"
          value={layout.details}
          options={PRODUCT_LAYOUT_OPTIONS.details}
          label={(o) => PRODUCT_LAYOUT_LABELS.details[o]}
          diagram={(o) => <DetailsDiagram style={o} />}
          onChange={(details) => set({ details })}
          disabled={disabled}
          error={errors.details}
        />
      </div>
      <figure className="flex flex-col gap-2 self-start">
        <LayoutPreview layout={layout} />
        <figcaption className="text-xs text-muted-foreground">Preview of a product page with these choices.</figcaption>
      </figure>
    </div>
  )

  if (variant === 'drawer') {
    return (
      <section className="@container flex flex-col gap-3" aria-label={TITLE}>
        <div className="flex items-start justify-between gap-2">
          <div className="flex flex-col gap-1">
            <h3 className="text-sm font-semibold">{TITLE}</h3>
            <p className="text-xs text-muted-foreground">{DESCRIPTION}</p>
          </div>
        </div>
        {body}
        {reset && <div>{reset}</div>}
      </section>
    )
  }

  return (
    <Card role="region" aria-labelledby={`${ids}-title`}>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
        <div className="flex flex-col gap-1.5">
          <CardTitle id={`${ids}-title`}>{TITLE}</CardTitle>
          <CardDescription>{DESCRIPTION}</CardDescription>
        </div>
        {reset}
      </CardHeader>
      <CardContent>{body}</CardContent>
    </Card>
  )
}

function ChoiceGroup<T extends string>({ name, legend, hint, value, options, label, diagram, onChange, disabled, error }: {
  name: string
  legend: string
  hint?: string
  value: T
  options: readonly T[]
  label: (option: T) => string
  diagram: (option: T) => ReactNode
  onChange: (value: T) => void
  disabled: boolean
  error?: string
}) {
  return (
    <fieldset className="flex min-w-0 flex-col gap-2" aria-describedby={hint || error ? `${name}-message` : undefined}>
      <legend className="mb-2 text-sm font-medium">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((option, index) => (
          <label
            key={option}
            className={cn(
              // relative: the visually hidden radio sits inside its option, so keyboard focus scrolls to it.
              'relative flex min-w-32 flex-1 cursor-pointer items-center gap-2.5 rounded-md border bg-card p-2 text-sm transition hover:border-primary/60 has-checked:border-primary has-checked:ring-2 has-checked:ring-primary/30 has-disabled:cursor-not-allowed has-disabled:opacity-60 has-focus-visible:ring-3 has-focus-visible:ring-ring/50 sm:flex-none',
            )}
          >
            <input
              type="radio"
              name={name}
              value={option}
              checked={value === option}
              onChange={() => onChange(option)}
              disabled={disabled}
              aria-label={label(option)}
              aria-describedby={index === 0 ? `${name}-standard` : undefined}
              className="sr-only"
            />
            <span className="shrink-0 text-muted-foreground">{diagram(option)}</span>
            <span className="flex flex-col">
              <span className="font-medium">{label(option)}</span>
              {index === 0 && <span id={`${name}-standard`} className="text-xs text-muted-foreground">Standard</span>}
            </span>
          </label>
        ))}
      </div>
      {error ? (
        <p id={`${name}-message`} className="text-sm text-destructive">{error}</p>
      ) : hint ? (
        <p id={`${name}-message`} className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </fieldset>
  )
}

/* Small schematic drawings (decorative; the labels carry the meaning). */

const SHAPE = 'fill-muted-foreground/30'
const FAINT = 'fill-muted-foreground/15'
const LINE = 'fill-none stroke-muted-foreground/45'
const ACCENT = 'fill-primary'

function Mini({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 48 32" width={48} height={32} aria-hidden className="block rounded-sm border bg-background">
      {children}
    </svg>
  )
}

function GalleryDiagram({ side }: { side: ProductGallerySide }) {
  const photo = side === 'left' ? 4 : 24
  const text = side === 'left' ? 28 : 4
  return (
    <Mini>
      <rect x={photo} y={4} width={20} height={24} rx={2} className={SHAPE} />
      <rect x={text} y={6} width={16} height={3} rx={1} className={SHAPE} />
      <rect x={text} y={12} width={11} height={3} rx={1} className={FAINT} />
      <rect x={text} y={21} width={16} height={5} rx={1.5} className={ACCENT} />
    </Mini>
  )
}

function ThumbnailsDiagram({ place }: { place: ProductThumbnails }) {
  return (
    <Mini>
      {place === 'bottom' ? (
        <>
          <rect x={10} y={3} width={28} height={19} rx={2} className={SHAPE} />
          {[10, 17.5, 25, 32.5].map((x) => <rect key={x} x={x} y={24.5} width={5.5} height={5} rx={1} className={FAINT} />)}
        </>
      ) : (
        <>
          {[3, 10, 17, 24].map((y) => <rect key={y} x={6} y={y} width={5} height={5} rx={1} className={FAINT} />)}
          <rect x={13} y={3} width={29} height={26} rx={2} className={SHAPE} />
        </>
      )}
    </Mini>
  )
}

function DetailsDiagram({ style }: { style: ProductDetailsStyle }) {
  return (
    <Mini>
      {style === 'tabs' && (
        <>
          <rect x={4} y={4} width={12} height={5} rx={1} className={ACCENT} />
          <rect x={18} y={4} width={12} height={5} rx={1} className={FAINT} />
          <rect x={32} y={4} width={12} height={5} rx={1} className={FAINT} />
          <rect x={4.5} y={11.5} width={39} height={16} rx={1.5} className={LINE} />
          <rect x={8} y={15} width={26} height={2.5} rx={1} className={FAINT} />
          <rect x={8} y={21} width={20} height={2.5} rx={1} className={FAINT} />
        </>
      )}
      {style === 'accordion' &&
        [4, 13, 22].map((y) => (
          <g key={y}>
            <rect x={4.5} y={y + 0.5} width={39} height={6} rx={1.5} className={LINE} />
            <rect x={8} y={y + 2.5} width={16} height={2} rx={1} className={SHAPE} />
            <path d={`M37 ${y + 2.5} l2 2 l2 -2`} className="fill-none stroke-muted-foreground" strokeWidth={1} />
          </g>
        ))}
      {style === 'stacked' &&
        [3, 13, 23].map((y) => (
          <g key={y}>
            <rect x={4} y={y} width={14} height={3} rx={1} className={SHAPE} />
            <rect x={4} y={y + 5} width={38} height={2} rx={1} className={FAINT} />
          </g>
        ))}
    </Mini>
  )
}

/** The whole page in miniature: gallery and buy box, then the details. */
function LayoutPreview({ layout }: { layout: ProductLayout }) {
  const gx = layout.gallery === 'left' ? 10 : 126
  const sx = layout.gallery === 'left' ? 126 : 10

  return (
    <svg viewBox="0 0 240 168" role="img" aria-label={describeProductLayout(layout)} className="w-full max-w-64 rounded-md border bg-background" data-testid="product-layout-preview">
      {layout.thumbnails === 'bottom' ? (
        <>
          <rect x={gx} y={10} width={104} height={72} rx={4} className={SHAPE} />
          {[0, 1, 2, 3].map((i) => <rect key={i} x={gx + i * 27} y={88} width={23} height={16} rx={2} className={i === 0 ? SHAPE : FAINT} />)}
        </>
      ) : (
        <>
          {[0, 1, 2, 3].map((i) => <rect key={i} x={gx} y={10 + i * 20} width={16} height={16} rx={2} className={i === 0 ? SHAPE : FAINT} />)}
          <rect x={gx + 20} y={10} width={84} height={94} rx={4} className={SHAPE} />
        </>
      )}
      <g>
        {layout.sticky_summary && <rect x={sx - 4} y={6} width={112} height={88} rx={4} strokeDasharray="4 3" className="fill-primary/5 stroke-primary" />}
        <rect x={sx} y={12} width={80} height={7} rx={2} className={SHAPE} />
        <rect x={sx} y={25} width={40} height={8} rx={2} className={ACCENT} />
        <rect x={sx} y={40} width={100} height={4} rx={2} className={FAINT} />
        <rect x={sx} y={48} width={86} height={4} rx={2} className={FAINT} />
        {[0, 1, 2].map((i) => <rect key={i} x={sx + i * 22} y={58} width={18} height={10} rx={2} className={LINE} />)}
        <rect x={sx} y={76} width={100} height={12} rx={3} className={ACCENT} />
      </g>
      {layout.details === 'tabs' && (
        <>
          {[0, 1, 2].map((i) => <rect key={i} x={10 + i * 44} y={112} width={40} height={9} rx={2} className={i === 0 ? ACCENT : FAINT} />)}
          <rect x={10.5} y={123.5} width={219} height={36} rx={3} className={LINE} />
          <rect x={18} y={131} width={150} height={4} rx={2} className={FAINT} />
          <rect x={18} y={139} width={180} height={4} rx={2} className={FAINT} />
          <rect x={18} y={147} width={120} height={4} rx={2} className={FAINT} />
        </>
      )}
      {layout.details === 'accordion' &&
        [112, 128, 144].map((y) => (
          <g key={y}>
            <rect x={10.5} y={y + 0.5} width={219} height={12} rx={3} className={LINE} />
            <rect x={18} y={y + 4.5} width={60} height={4} rx={2} className={SHAPE} />
            <path d={`M214 ${y + 4.5} l4 4 l4 -4`} className="fill-none stroke-muted-foreground" strokeWidth={1.5} />
          </g>
        ))}
      {layout.details === 'stacked' &&
        [112, 128, 144].map((y) => (
          <g key={y}>
            <rect x={10} y={y} width={56} height={5} rx={2} className={SHAPE} />
            <rect x={10} y={y + 9} width={200} height={3} rx={1.5} className={FAINT} />
          </g>
        ))}
    </svg>
  )
}
