import type { ReactNode } from 'react'
import type { Style } from '@/storefront/builder/types'
import { ColorControl } from './color-control'
import type { PaletteColor } from './color-utils'
import { Segmented } from './primitives'
import { ShadowControl } from './shadow-control'

export type Hover = NonNullable<NonNullable<Style['effects']>['hover']>
export type HoverKey = keyof Hover

/**
 * What changes when a shopper points at (or tabs to) the element: text colour, background,
 * shadow and a small movement (lift / grow; switched off for people who prefer reduced motion).
 */
export function HoverControl({ value, onChange, statusFor, parts = ['transform', 'color', 'background_color', 'shadow'], themeColors, palette }: {
  value: Hover
  onChange: <K extends HoverKey>(key: K, value: Hover[K] | undefined) => void
  statusFor?: (key: HoverKey) => ReactNode
  parts?: readonly HoverKey[]
  themeColors?: Record<string, string>
  palette?: readonly PaletteColor[]
}) {
  const show = (key: HoverKey) => parts.includes(key)
  return (
    <div className="flex flex-col gap-3" data-control="hover">
      {show('transform') && (
        <Segmented
          label="Movement on hover"
          tooltip="A small lift or grow when pointed at. Visitors who turn off animations don’t see it."
          value={value.transform}
          options={[
            { value: 'none', label: 'None' },
            { value: 'lift', label: 'Lift' },
            { value: 'grow', label: 'Grow' },
          ]}
          onChange={(transform) => onChange('transform', transform)}
          status={statusFor?.('transform')}
        />
      )}
      {show('color') && (
        <ColorControl label="Text colour on hover" value={value.color ?? null} onChange={(c) => onChange('color', c ?? undefined)} themeColors={themeColors} palette={palette} allowTokens allowAlpha placeholder="No change" status={statusFor?.('color')} />
      )}
      {show('background_color') && (
        <ColorControl label="Background on hover" value={value.background_color ?? null} onChange={(c) => onChange('background_color', c ?? undefined)} themeColors={themeColors} palette={palette} allowTokens allowAlpha placeholder="No change" status={statusFor?.('background_color')} />
      )}
      {show('shadow') && <ShadowControl label="Shadow on hover" value={value.shadow} onChange={(s) => onChange('shadow', s)} themeColors={themeColors} palette={palette} status={statusFor?.('shadow')} />}
    </div>
  )
}
