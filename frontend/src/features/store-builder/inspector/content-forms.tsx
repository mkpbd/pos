/*
 * Content tab forms of the builder's own node types: heading, text, image, button, divider,
 * spacer, section, column and inner row. Wrapped homepage sections use WrappedSectionForm.
 */

import { ArrowUpLeftIcon } from 'lucide-react'
import { FormField } from '@/components/common/form-field'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { RichTextEditor } from '@/features/content/components/rich-text-editor'
import { cn } from '@/lib/utils'
import type { ButtonElement, Column, DividerElement, HeadingElement, ImageElement, InnerRowElement, Section, SpacerElement, Style, TextElement } from '@/storefront/builder/types'
import type { MediaRef } from '@/storefront/types'
import { FieldError, ImageChooser, LinkField, NodeBangla, ThemeColorField, type Errors } from './fields'
import { COLUMN_PRESETS, currentPreset } from './tree-lookup'
import { DIVIDER_THICKNESS, DIVIDER_WIDTH, TEXT_LIMITS } from './validate'
import type { BuilderNode, ColumnPreset, InspectorChangeOptions, InspectorCommand } from './types'

export type FormProps<N> = {
  node: N
  onChange: (next: N, opts?: InspectorChangeOptions) => void
  errors: Errors
  /** Bangla is enabled for the store. */
  bangla: boolean
}

function setProps<N extends { id: string; props: object }>(node: N, onChange: FormProps<N>['onChange'], patch: Partial<N['props']>, key?: string, media?: Record<string, MediaRef>) {
  onChange({ ...node, props: { ...node.props, ...patch } }, { ...(key ? { coalesceKey: `${node.id}:${key}` } : {}), ...(media ? { media } : {}) })
}

const counter = (text: string, max: number) => `${text.length}/${max}`

/* ---------------------------------------------------------------------------------------------- */

const LEVELS = [
  { value: 1, label: 'Heading 1 – largest (once per page)' },
  { value: 2, label: 'Heading 2 – section title' },
  { value: 3, label: 'Heading 3' },
  { value: 4, label: 'Heading 4' },
  { value: 5, label: 'Heading 5' },
  { value: 6, label: 'Heading 6 – smallest' },
]

export function HeadingForm({ node, onChange, errors, bangla }: FormProps<HeadingElement>) {
  const p = node.props
  return (
    <div className="flex flex-col gap-4">
      <FormField label="Heading text" error={errors.text} hint={counter(p.text, TEXT_LIMITS.heading)}>
        <Textarea rows={2} maxLength={TEXT_LIMITS.heading} value={p.text} onChange={(e) => setProps(node, onChange, { text: e.target.value }, 'text')} />
      </FormField>
      <FormField label="Size and importance" error={errors.level} hint="Search engines read the levels as the page outline.">
        <Select value={String(p.level)} onValueChange={(v) => setProps(node, onChange, { level: Number(v) as HeadingElement['props']['level'] })}>
          <SelectTrigger className="w-full" aria-label="Size and importance"><SelectValue /></SelectTrigger>
          <SelectContent>{LEVELS.map((l) => <SelectItem key={l.value} value={String(l.value)}>{l.label}</SelectItem>)}</SelectContent>
        </Select>
      </FormField>
      <LinkField key={node.id} label="Link" value={p.link?.url ?? null} onChange={(url) => setProps(node, onChange, { link: url === null ? null : { url } }, 'link')} error={errors.link} hint="Optional: the heading becomes a link." />
      {bangla && (
        <NodeBangla
          fields={[{ name: 'text', label: 'Heading text', base: p.text, max: TEXT_LIMITS.heading }]}
          translations={node.translations}
          errors={errors}
          onChange={(translations) => onChange({ ...node, translations }, { coalesceKey: `${node.id}:bn` })}
        />
      )}
    </div>
  )
}

export function TextForm({ node, onChange, errors, bangla }: FormProps<TextElement>) {
  const id = `text-${node.id}`
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={id}>Text</Label>
        <RichTextEditor key={node.id} id={id} label="Text" value={node.props.html} invalid={!!errors.html} onChange={(html) => setProps(node, onChange, { html }, 'html')} />
        <FieldError message={errors.html} />
      </div>
      {bangla && (
        <NodeBangla
          fields={[{ name: 'html', label: 'Text', base: node.props.html, kind: 'rich' }]}
          translations={node.translations}
          errors={errors}
          onChange={(translations) => onChange({ ...node, translations }, { coalesceKey: `${node.id}:bn` })}
        />
      )}
    </div>
  )
}

const ASPECTS: { value: ImageElement['props']['aspect']; label: string }[] = [
  { value: 'auto', label: 'Original shape' },
  { value: '1:1', label: 'Square (1:1)' },
  { value: '4:3', label: 'Landscape (4:3)' },
  { value: '3:2', label: 'Photo (3:2)' },
  { value: '16:9', label: 'Wide (16:9)' },
  { value: '3:4', label: 'Portrait (3:4)' },
]

export function ImageForm({ node, onChange, errors, bangla }: FormProps<ImageElement>) {
  const p = node.props
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Image</span>
        <ImageChooser
          title="Choose an image"
          value={p.media_id}
          error={errors.media_id}
          onChange={(media_id, ref) => setProps(node, onChange, { media_id }, undefined, ref ? { [ref.id]: ref } : undefined)}
        />
      </div>
      <FormField label="Description (alt text)" error={errors.alt} hint="Describes the picture for screen readers and search engines.">
        <Input maxLength={TEXT_LIMITS.alt} value={p.alt} onChange={(e) => setProps(node, onChange, { alt: e.target.value }, 'alt')} />
      </FormField>
      <LinkField key={node.id} label="Link" value={p.link?.url ?? null} onChange={(url) => setProps(node, onChange, { link: url === null ? null : { url } }, 'link')} error={errors.link} hint="Optional: the image becomes a link." />
      <FormField label="Shape" error={errors.aspect}>
        <Select value={p.aspect} onValueChange={(v) => setProps(node, onChange, { aspect: v as ImageElement['props']['aspect'] })}>
          <SelectTrigger className="w-full" aria-label="Shape"><SelectValue /></SelectTrigger>
          <SelectContent>{ASPECTS.map((a) => <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>)}</SelectContent>
        </Select>
      </FormField>
      {p.aspect !== 'auto' && (
        <FormField label="Fit" error={errors.fit}>
          <Select value={p.fit} onValueChange={(v) => setProps(node, onChange, { fit: v as ImageElement['props']['fit'] })}>
            <SelectTrigger className="w-full" aria-label="Fit"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="cover">Fill the shape (may crop)</SelectItem>
              <SelectItem value="contain">Show the whole image</SelectItem>
            </SelectContent>
          </Select>
        </FormField>
      )}
      {bangla && (
        <NodeBangla
          fields={[{ name: 'alt', label: 'Description (alt text)', base: p.alt, max: TEXT_LIMITS.alt }]}
          translations={node.translations}
          errors={errors}
          onChange={(translations) => onChange({ ...node, translations }, { coalesceKey: `${node.id}:bn` })}
        />
      )}
    </div>
  )
}

export function ButtonForm({ node, onChange, errors, bangla }: FormProps<ButtonElement>) {
  const p = node.props
  return (
    <div className="flex flex-col gap-4">
      <FormField label="Button text" error={errors.label} hint={counter(p.label, TEXT_LIMITS.buttonLabel)}>
        <Input maxLength={TEXT_LIMITS.buttonLabel} value={p.label} onChange={(e) => setProps(node, onChange, { label: e.target.value }, 'label')} />
      </FormField>
      <LinkField key={node.id} required label="Opens" value={p.link?.url ?? ''} onChange={(url) => setProps(node, onChange, { link: { url: url ?? '' } }, 'link')} error={errors.link} />
      <FormField label="Look" error={errors.variant}>
        <Select value={p.variant} onValueChange={(v) => setProps(node, onChange, { variant: v as ButtonElement['props']['variant'] })}>
          <SelectTrigger className="w-full" aria-label="Look"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="primary">Primary (theme colour)</SelectItem>
            <SelectItem value="accent">Accent</SelectItem>
            <SelectItem value="outline">Outline</SelectItem>
            <SelectItem value="link">Text link</SelectItem>
          </SelectContent>
        </Select>
      </FormField>
      <FormField label="Size" error={errors.size}>
        <Select value={p.size} onValueChange={(v) => setProps(node, onChange, { size: v as ButtonElement['props']['size'] })}>
          <SelectTrigger className="w-full" aria-label="Size"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="sm">Small</SelectItem>
            <SelectItem value="md">Medium</SelectItem>
            <SelectItem value="lg">Large</SelectItem>
          </SelectContent>
        </Select>
      </FormField>
      <div className="flex items-center gap-2">
        <Switch id={`full-${node.id}`} checked={p.full_width} onCheckedChange={(full_width) => setProps(node, onChange, { full_width })} />
        <Label htmlFor={`full-${node.id}`}>Full width</Label>
      </div>
      {bangla && (
        <NodeBangla
          fields={[{ name: 'label', label: 'Button text', base: p.label, max: TEXT_LIMITS.buttonLabel }]}
          translations={node.translations}
          errors={errors}
          onChange={(translations) => onChange({ ...node, translations }, { coalesceKey: `${node.id}:bn` })}
        />
      )}
    </div>
  )
}

const range = (min: number, max: number, step = 1) => Array.from({ length: Math.floor((max - min) / step) + 1 }, (_, i) => min + i * step)

export function DividerForm({ node, onChange, errors }: FormProps<DividerElement>) {
  const p = node.props
  const widths = [...new Set([...range(DIVIDER_WIDTH.min, DIVIDER_WIDTH.max, 10), p.width])].filter((n) => Number.isInteger(n)).sort((a, b) => a - b)
  return (
    <div className="flex flex-col gap-4">
      <FormField label="Line" error={errors.line}>
        <Select value={p.line} onValueChange={(v) => setProps(node, onChange, { line: v as DividerElement['props']['line'] })}>
          <SelectTrigger className="w-full" aria-label="Line"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="solid">Solid</SelectItem>
            <SelectItem value="dashed">Dashed</SelectItem>
            <SelectItem value="dotted">Dotted</SelectItem>
          </SelectContent>
        </Select>
      </FormField>
      <FormField label="Thickness" error={errors.thickness}>
        <Select value={String(p.thickness)} onValueChange={(v) => setProps(node, onChange, { thickness: Number(v) })}>
          <SelectTrigger className="w-full" aria-label="Thickness"><SelectValue /></SelectTrigger>
          <SelectContent>{range(DIVIDER_THICKNESS.min, DIVIDER_THICKNESS.max).map((n) => <SelectItem key={n} value={String(n)}>{n} px</SelectItem>)}</SelectContent>
        </Select>
      </FormField>
      <FormField label="Width" error={errors.width}>
        <Select value={String(p.width)} onValueChange={(v) => setProps(node, onChange, { width: Number(v) })}>
          <SelectTrigger className="w-full" aria-label="Width"><SelectValue /></SelectTrigger>
          <SelectContent>{widths.map((n) => <SelectItem key={n} value={String(n)}>{n} %</SelectItem>)}</SelectContent>
        </Select>
      </FormField>
      {p.width < 100 && (
        <FormField label="Alignment" error={errors.align}>
          <Select value={p.align} onValueChange={(v) => setProps(node, onChange, { align: v as DividerElement['props']['align'] })}>
            <SelectTrigger className="w-full" aria-label="Alignment"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="left">Left</SelectItem>
              <SelectItem value="center">Centre</SelectItem>
              <SelectItem value="right">Right</SelectItem>
            </SelectContent>
          </Select>
        </FormField>
      )}
      <ThemeColorField label="Colour" value={p.color} onChange={(color) => setProps(node, onChange, { color }, 'color')} error={errors.color} />
    </div>
  )
}

/** Spacer heights; the only style value B2 writes (`style.base.size.height`). */
const SPACER_HEIGHTS = [
  { value: '16px', label: 'Small (16 px)' },
  { value: '32px', label: 'Medium (32 px)' },
  { value: '64px', label: 'Large (64 px)' },
  { value: '96px', label: 'Extra large (96 px)' },
] as const
const STANDARD = 'standard'

export function SpacerForm({ node, onChange }: FormProps<SpacerElement>) {
  const height = node.style.base?.size?.height
  const known = SPACER_HEIGHTS.some((h) => h.value === height)
  const setHeight = (value: string) => {
    const base: Style = { ...node.style.base }
    const size = { ...base.size }
    if (value === STANDARD) delete size.height
    else size.height = value
    if (Object.keys(size).length > 0) base.size = size
    else delete base.size
    const style = { ...node.style }
    if (Object.keys(base).length > 0) style.base = base
    else delete style.base
    onChange({ ...node, style })
  }
  return (
    <FormField label="Height" hint="Empty space between elements.">
      <Select value={height === undefined ? STANDARD : height} onValueChange={setHeight}>
        <SelectTrigger className="w-full" aria-label="Height"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value={STANDARD}>Standard (24 px)</SelectItem>
          {SPACER_HEIGHTS.map((h) => <SelectItem key={h.value} value={h.value}>{h.label}</SelectItem>)}
          {height !== undefined && !known && <SelectItem value={height}>Custom ({height})</SelectItem>}
        </SelectContent>
      </Select>
    </FormField>
  )
}

/* ---------------------------------------------------------------------------------------------- */

/** Buttons for the column presets of a section or inner row; applied by the editor's tree op. */
export function ColumnPresetPicker({ nodeId, columns, onCommand, label = 'Columns' }: { nodeId: string; columns: { width: { base: number } }[]; onCommand: (cmd: InspectorCommand) => void; label?: string }) {
  const current = currentPreset(columns)
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1.5 text-sm font-medium">{label}</legend>
      <div className="grid grid-cols-4 gap-2" role="group" aria-label="Column layouts">
        {COLUMN_PRESETS.map(({ preset, label: name, widths }) => (
          <button
            key={preset}
            type="button"
            title={name}
            aria-label={name}
            aria-pressed={current === preset}
            onClick={() => current !== preset && onCommand({ type: 'set-column-preset', nodeId, preset: preset as ColumnPreset })}
            className={cn(
              'flex h-9 items-stretch gap-0.5 rounded-md border p-1 outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50',
              current === preset && 'border-primary bg-primary/10',
            )}
          >
            {widths.map((w, i) => <span key={i} className={cn('rounded-sm', current === preset ? 'bg-primary/70' : 'bg-muted-foreground/40')} style={{ flexGrow: w }} />)}
          </button>
        ))}
      </div>
      <p className="text-sm text-muted-foreground">
        {current ? `${columns.length} column${columns.length === 1 ? '' : 's'}.` : `Custom layout with ${columns.length} column${columns.length === 1 ? '' : 's'}.`} Removing columns moves their content into the last remaining column.
        Columns stack on mobile.
      </p>
    </fieldset>
  )
}

const LAYOUTS: { value: Section['props']['layout']; label: string; hint: string }[] = [
  { value: 'boxed', label: 'Boxed', hint: 'Content in the store’s page width.' },
  { value: 'full', label: 'Full width background', hint: 'Background across the screen, content in the page width.' },
  { value: 'full-bleed', label: 'Edge to edge', hint: 'Content across the whole screen.' },
]

export function SectionForm({ node, onChange, errors, onCommand }: FormProps<Section> & { onCommand: (cmd: InspectorCommand) => void }) {
  const layout = LAYOUTS.find((l) => l.value === node.props.layout)
  return (
    <div className="flex flex-col gap-4">
      <FormField label="Width" error={errors.layout} hint={layout?.hint}>
        <Select value={node.props.layout} onValueChange={(v) => setProps(node, onChange, { layout: v as Section['props']['layout'] })}>
          <SelectTrigger className="w-full" aria-label="Width"><SelectValue /></SelectTrigger>
          <SelectContent>{LAYOUTS.map((l) => <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>)}</SelectContent>
        </Select>
      </FormField>
      <ColumnPresetPicker nodeId={node.id} columns={node.columns} onCommand={onCommand} />
      <FieldError message={errors.columns} />
    </div>
  )
}

export function InnerRowForm({ node, errors, onCommand }: FormProps<InnerRowElement> & { onCommand: (cmd: InspectorCommand) => void }) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">An inner row places elements side by side inside a column.</p>
      <ColumnPresetPicker nodeId={node.id} columns={node.columns} onCommand={onCommand} label="Columns in this row" />
      <FieldError message={errors.columns} />
    </div>
  )
}

const pct = (n: number | undefined) => (n === undefined ? undefined : `${Number.isInteger(n) ? n : n.toFixed(2).replace(/0+$/, '')} %`)

export function ColumnInfo({ node, parent, onCommand }: { node: Column; parent: BuilderNode | null; onCommand: (cmd: InspectorCommand) => void }) {
  const desktop = pct(node.width.base) ?? '100 %'
  const tablet = pct(node.width.tablet) ?? `${desktop} (as desktop)`
  const mobile = pct(node.width.mobile) ?? `${pct(node.width.tablet) ?? desktop} (as tablet)`
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">A column holds elements. Change the column layout on its section or inner row.</p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm" aria-label="Column width per device">
        <dt className="text-muted-foreground">Desktop</dt>
        <dd>{desktop}</dd>
        <dt className="text-muted-foreground">Tablet</dt>
        <dd>{tablet}</dd>
        <dt className="text-muted-foreground">Mobile</dt>
        <dd>{mobile}</dd>
      </dl>
      <p className="text-sm text-muted-foreground">{node.elements.length === 0 ? 'Empty: drag elements here.' : `${node.elements.length} element${node.elements.length === 1 ? '' : 's'}.`}</p>
      {parent && (
        <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => onCommand({ type: 'select', nodeId: parent.id })}>
          <ArrowUpLeftIcon data-icon="inline-start" /> {parent.type === 'section' ? 'Select the section' : 'Select the inner row'}
        </Button>
      )}
    </div>
  )
}
