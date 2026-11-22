import { useId } from 'react'
import { SlidersHorizontalIcon } from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import type { Device, ResponsiveStyle, Sides } from '@/storefront/builder/types'
import { Segmented } from '../controls'
import { useEaseUi } from './ease-context'

/*
 * B21 Easy mode controls: the switch in the inspector header, the "More options" link that
 * switches to full mode, the Style tab's groups in Easy mode and the S / M / L spacing presets
 * that replace the spacing numbers.
 */

/** "Easy" switch in the inspector header (inside the editor only). */
export function EasyModeSwitch() {
  const { easy, setEasy, available } = useEaseUi()
  const id = useId()
  if (!available) return null
  return (
    <span className="flex shrink-0 items-center gap-1.5" title="Easy mode — fewer controls" data-testid="easy-mode-switch">
      <Switch id={id} size="sm" checked={easy} onCheckedChange={(on) => setEasy(on === true)} aria-describedby={`${id}-hint`} />
      <label htmlFor={id} className="text-xs font-medium">
        Easy mode
      </label>
      <span id={`${id}-hint`} className="sr-only">
        Fewer controls. Turn it off to see every option.
      </span>
    </span>
  )
}

/** Easy mode: a short line with "More options" (full mode). */
export function MoreOptionsLink({ className }: { className?: string }) {
  const { easy, setEasy, available } = useEaseUi()
  if (!available || !easy) return null
  return (
    <p className={className ?? 'flex items-center gap-1.5 text-xs text-muted-foreground'} data-testid="more-options">
      <SlidersHorizontalIcon className="size-3.5 shrink-0" aria-hidden />
      <span>Easy mode shows the main controls.</span>
      <button type="button" onClick={() => setEasy(false)} className="font-medium text-primary underline underline-offset-2 outline-none hover:no-underline focus-visible:ring-2 focus-visible:ring-ring">
        More options
      </button>
    </p>
  )
}

const DEVICE_WORD: Record<Device, string> = { desktop: 'computer', tablet: 'tablet', mobile: 'phone' }

/** Easy mode: changes apply on every device; a note when this part has its own settings for the device shown. */
export function EasyDeviceNote({ style, device }: { style: ResponsiveStyle | undefined; device: Device }) {
  const own = device === 'mobile' ? style?.mobile ?? style?.tablet : device === 'tablet' ? style?.tablet : undefined
  const hasOwn = own !== undefined && Object.keys(own).length > 0
  return (
    <div className="flex flex-col gap-1 rounded-md border border-primary/30 bg-primary/5 p-3" data-testid="easy-device-note">
      <p className="text-sm font-medium">Changes apply on every device.</p>
      {hasOwn && <p className="text-xs text-muted-foreground">On a {DEVICE_WORD[device]} this part also has its own settings. More options shows them.</p>}
    </div>
  )
}

/* ---------------------------------------------------------------------------------------------- */

type Preset = 'none' | 's' | 'm' | 'l'

const PRESET_OPTIONS: readonly { value: Preset; label: string; title: string }[] = [
  { value: 'none', label: 'None', title: 'No space' },
  { value: 's', label: 'S', title: 'Small' },
  { value: 'm', label: 'M', title: 'Medium' },
  { value: 'l', label: 'L', title: 'Large' },
]

/** Sections, inner rows and columns get roomier steps (top and bottom); elements smaller ones (all sides). */
const BIG: Record<Preset, string> = { none: '0px', s: '24px', m: '48px', l: '96px' }
const SMALL: Record<Preset, string> = { none: '0px', s: '8px', m: '16px', l: '32px' }
const BELOW: Record<Preset, string> = { none: '0px', s: '8px', m: '16px', l: '32px' }

const isBox = (type: string) => type === 'section' || type === 'inner_row' || type === 'column'

function matchPreset(values: Record<Preset, string>, sides: (string | undefined)[]): Preset | undefined {
  return (Object.keys(values) as Preset[]).find((key) => sides.every((side) => side === values[key]))
}

/**
 * Easy mode spacing: "Space inside" (padding) and, for elements, "Space below" (bottom margin) as
 * None / S / M / L. A value set in full mode that matches no step shows no step chosen.
 */
export function SpacingPresets({ nodeType, value, onChange }: {
  nodeType: string
  value: { margin: Sides; padding: Sides }
  onChange: (box: 'margin' | 'padding', sides: Sides) => void
}) {
  const box = isBox(nodeType)
  const inside = box ? BIG : SMALL
  const padding = value.padding
  const insideSides = box ? [padding.top, padding.bottom] : [padding.top, padding.right, padding.bottom, padding.left]
  return (
    <div className="flex flex-col gap-3" data-testid="spacing-presets">
      <Segmented<Preset>
        label="Space inside"
        tooltip={box ? 'Room above and below the content.' : 'Room between the edge and the content.'}
        value={matchPreset(inside, insideSides)}
        options={PRESET_OPTIONS}
        onChange={(preset) => {
          const v = inside[preset]
          onChange('padding', box ? { ...padding, top: v, bottom: v } : { top: v, right: v, bottom: v, left: v })
        }}
      />
      {!box && (
        <Segmented<Preset>
          label="Space below"
          tooltip="Room between this and what comes after it."
          value={matchPreset(BELOW, [value.margin.bottom])}
          options={PRESET_OPTIONS}
          onChange={(preset) => onChange('margin', { ...value.margin, bottom: BELOW[preset] })}
        />
      )}
    </div>
  )
}
