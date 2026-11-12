import type { ReactNode } from 'react'
import { Switch } from '@/components/ui/switch'
import type { Background, BackgroundPosition, Gradient } from '@/storefront/builder/types'
import type { MediaRef } from '@/storefront/types'
import { ImageChooser } from '../inspector/fields'
import { ColorControl } from './color-control'
import type { PaletteColor } from './color-utils'
import { ControlLabel } from './control-label'
import { GradientControl } from './gradient-control'
import { DEFAULT_OVERLAY_COLOR, DEFAULT_OVERLAY_GRADIENT, switchBackgroundType } from './model'
import { Segmented, SelectControl } from './primitives'

const POSITIONS: { value: BackgroundPosition; label: string }[] = [
  { value: 'center', label: 'Centre' },
  { value: 'top', label: 'Top' },
  { value: 'bottom', label: 'Bottom' },
  { value: 'left', label: 'Left' },
  { value: 'right', label: 'Right' },
  { value: 'top-left', label: 'Top left' },
  { value: 'top-right', label: 'Top right' },
  { value: 'bottom-left', label: 'Bottom left' },
  { value: 'bottom-right', label: 'Bottom right' },
]

/**
 * A background: none, a colour, a gradient or an image from the media library (position, size,
 * repeat), with an optional overlay colour or gradient on top (for readable text on photos).
 */
export function BackgroundControl({ label = 'Background', value, onChange, themeColors, palette, status, tooltip, allowImage = true }: {
  label?: string
  value: Background | undefined
  /** `media`: the image just chosen, so the canvas can draw it at once. */
  onChange: (value: Background, media?: Record<string, MediaRef>) => void
  themeColors?: Record<string, string>
  palette?: readonly PaletteColor[]
  status?: ReactNode
  tooltip?: string
  allowImage?: boolean
}) {
  const type = value?.type
  const set = (patch: Partial<Background>, media?: Record<string, MediaRef>) => onChange({ ...(value ?? { type: 'none' }), ...patch } as Background, media)
  const overlayKind = value?.overlay === undefined ? 'none' : typeof value.overlay === 'string' ? 'color' : 'gradient'
  const image = value?.image

  return (
    <div className="flex flex-col gap-3" data-control="background">
      <ControlLabel label={label} tooltip={tooltip} status={status} />
      <Segmented
        label={`${label} type`}
        hideLabel
        value={type}
        options={[
          { value: 'none', label: 'None' },
          { value: 'color', label: 'Colour' },
          { value: 'gradient', label: 'Gradient' },
          ...(allowImage ? [{ value: 'image' as const, label: 'Image' }] : []),
        ]}
        onChange={(next) => onChange(switchBackgroundType(value, next))}
      />

      {type === 'color' && (
        <ColorControl label={`${label} colour`} value={value?.color ?? null} onChange={(color) => color && set({ color })} themeColors={themeColors} palette={palette} allowTokens allowAlpha />
      )}
      {type === 'gradient' && <GradientControl label={`${label} gradient`} value={value?.gradient} onChange={(gradient) => set({ gradient })} themeColors={themeColors} palette={palette} />}
      {type === 'image' && (
        <div className="flex flex-col gap-3">
          <ImageChooser
            title="Choose a background image"
            value={image?.media_id ?? null}
            onChange={(id, ref) => {
              if (!id) {
                const next: Background = { type: 'image', ...(value?.overlay ? { overlay: value.overlay } : {}) }
                return onChange(next)
              }
              set({ image: { media_id: id, position: image?.position ?? 'center', size: image?.size ?? 'cover', repeat: image?.repeat ?? false } }, ref ? { [ref.id]: ref } : undefined)
            }}
          />
          {image && (
            <>
              <SelectControl label="Focus point" value={image.position} options={POSITIONS} onChange={(position) => set({ image: { ...image, position } })} tooltip="Which part of the picture stays in view when it is cropped." />
              <Segmented
                label="Fit"
                value={image.size}
                options={[
                  { value: 'cover', label: 'Fill', title: 'Fill the area (may crop)' },
                  { value: 'contain', label: 'Fit', title: 'Show the whole picture' },
                  { value: 'auto', label: 'Original', title: 'Original size' },
                ]}
                onChange={(size) => set({ image: { ...image, size } })}
              />
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={image.repeat} onCheckedChange={(repeat) => set({ image: { ...image, repeat } })} aria-label="Repeat the image" />
                Repeat (tile) the image
              </label>
            </>
          )}
        </div>
      )}

      {(type === 'image' || type === 'gradient') && (
        <div className="flex flex-col gap-2 rounded-md border p-2">
          <Segmented
            label="Overlay"
            tooltip="A see-through colour over the background so text on top stays readable."
            value={overlayKind}
            options={[
              { value: 'none', label: 'None' },
              { value: 'color', label: 'Colour' },
              { value: 'gradient', label: 'Gradient' },
            ]}
            onChange={(kind) => {
              if (!value) return
              const { overlay: _old, ...rest } = value
              void _old
              if (kind === 'none') return onChange(rest as Background)
              onChange({ ...rest, overlay: kind === 'color' ? DEFAULT_OVERLAY_COLOR : DEFAULT_OVERLAY_GRADIENT } as Background)
            }}
          />
          {overlayKind === 'color' && (
            <ColorControl label="Overlay colour" value={value?.overlay as string} onChange={(c) => c && set({ overlay: c })} themeColors={themeColors} palette={palette} allowTokens allowAlpha />
          )}
          {overlayKind === 'gradient' && (
            <GradientControl label="Overlay gradient" value={value?.overlay as Gradient} onChange={(g) => set({ overlay: g })} themeColors={themeColors} palette={palette} />
          )}
        </div>
      )}
    </div>
  )
}
