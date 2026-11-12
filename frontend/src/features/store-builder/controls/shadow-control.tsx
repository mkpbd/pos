import { useState, type ReactNode } from 'react'
import { PlusIcon, Trash2Icon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import type { Shadow } from '@/storefront/builder/types'
import { normalizeShadow } from '@/storefront/builder/validate'
import { ColorControl } from './color-control'
import type { PaletteColor } from './color-utils'
import { ControlLabel } from './control-label'
import { BOX_SHADOW_PRESETS, layer, shadowPreset, TEXT_SHADOW_PRESETS } from './model'
import { Segmented } from './primitives'


export type ShadowControlProps = {
  label: string
  /** `[]` = no shadow; undefined = not set. */
  value: Shadow[] | undefined
  onChange: (value: Shadow[]) => void
  /** A text shadow: at most 2 layers, no spread or inset. */
  text?: boolean
  themeColors?: Record<string, string>
  palette?: readonly PaletteColor[]
  status?: ReactNode
  tooltip?: string
}

const NUMBER_FIELDS: { key: 'x' | 'y' | 'blur' | 'spread'; label: string; min: number; max: number }[] = [
  { key: 'x', label: 'Across', min: -100, max: 100 },
  { key: 'y', label: 'Down', min: -100, max: 100 },
  { key: 'blur', label: 'Blur', min: 0, max: 200 },
  { key: 'spread', label: 'Spread', min: -100, max: 100 },
]

/** A shadow: presets (none / soft / medium / strong) and, under "Custom", a layer editor (≤ 3 layers, text ≤ 2). */
export function ShadowControl({ label, value, onChange, text = false, themeColors, palette, status, tooltip }: ShadowControlProps) {
  const max = text ? 2 : 3
  const presets = text ? TEXT_SHADOW_PRESETS : BOX_SHADOW_PRESETS
  const [editing, setEditing] = useState(false)
  const current = editing ? 'custom' : shadowPreset(value, text)
  const layers = value ?? []

  const write = (next: Shadow[]) => {
    if (next.length > max) return
    const valid = next.map((s) => normalizeShadow(s))
    if (valid.every((s): s is Shadow => s !== undefined)) onChange(valid)
  }
  const setLayer = (index: number, patch: Partial<Shadow>) => write(layers.map((s, i) => (i === index ? { ...s, ...patch } : s)))

  return (
    <div className="flex flex-col gap-2" data-control={text ? 'text-shadow' : 'shadow'}>
      <ControlLabel label={label} tooltip={tooltip} status={status} />
      <Segmented
        label={`${label} preset`}
        hideLabel
        value={current}
        options={[
          { value: 'none', label: 'None' },
          { value: 'soft', label: 'Soft' },
          { value: 'medium', label: 'Medium' },
          { value: 'strong', label: 'Strong' },
          { value: 'custom', label: 'Custom' },
        ]}
        onChange={(preset) => {
          setEditing(preset === 'custom')
          if (preset === 'none') write([])
          else if (preset === 'custom') write(layers.length > 0 ? layers : presets.soft)
          else write(presets[preset])
        }}
      />
      {current === 'custom' && (
        <div className="flex flex-col gap-3">
          {layers.map((shadow, index) => (
            <fieldset key={index} className="flex flex-col gap-2 rounded-md border p-2" data-testid={`shadow-layer-${index}`}>
              <legend className="px-1 text-xs font-medium">Layer {index + 1}</legend>
              <div className="grid grid-cols-2 gap-2">
                {NUMBER_FIELDS.filter((f) => !text || f.key !== 'spread').map((field) => (
                  <label key={field.key} className="flex flex-col gap-1 text-xs">
                    <span>{field.label} (px)</span>
                    <input
                      type="number"
                      min={field.min}
                      max={field.max}
                      value={shadow[field.key]}
                      aria-label={`Layer ${index + 1} ${field.label.toLowerCase()}`}
                      onChange={(e) => {
                        const n = Number(e.target.value)
                        if (e.target.value !== '' && Number.isFinite(n) && n >= field.min && n <= field.max) setLayer(index, { [field.key]: Math.round(n) })
                      }}
                      className="h-8 rounded-md border bg-transparent px-2 text-sm tabular-nums"
                    />
                  </label>
                ))}
              </div>
              <ColorControl label={`Layer ${index + 1} colour`} value={shadow.color} onChange={(color) => color && setLayer(index, { color })} themeColors={themeColors} palette={palette} allowTokens allowAlpha />
              <div className="flex items-center justify-between gap-2">
                {!text ? (
                  <label className="flex items-center gap-2 text-xs">
                    <Switch checked={shadow.inset} onCheckedChange={(inset) => setLayer(index, { inset })} aria-label={`Layer ${index + 1} inside`} />
                    Inside the box
                  </label>
                ) : <span />}
                <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove layer ${index + 1}`} onClick={() => write(layers.filter((_, i) => i !== index))}>
                  <Trash2Icon />
                </Button>
              </div>
            </fieldset>
          ))}
          <Button type="button" variant="outline" size="sm" className="self-start" disabled={layers.length >= max} onClick={() => write([...layers, layer(0, 4, 12, 0, '#00000033')])}>
            <PlusIcon data-icon="inline-start" /> Add layer
          </Button>
        </div>
      )}
    </div>
  )
}
