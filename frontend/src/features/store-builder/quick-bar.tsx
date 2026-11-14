import { useState } from 'react'
import { AlignCenterIcon, AlignLeftIcon, AlignRightIcon, BaselineIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import type { BuilderNode, Device, ResponsiveStyle } from '@/storefront/builder/types'
import { ColorEditor, resolveColor, type PaletteColor } from './controls'
import { BREAKPOINT, DEVICE_LABEL, resolveStyleValue, type StylePath } from './inspector/style-model'
import { ALIGN_PATH, COLOR_PATH, type QuickAlign } from './quick-style'

/*
 * B10 quick bar (contract §1): for text elements the canvas mini toolbar offers alignment (left,
 * centre, right) and the text colour (theme colours, the store palette or any colour). Both write
 * to the device being edited — sparse per-device styles, like the Style tab.
 */

const ALIGNS: { value: QuickAlign; label: string; icon: typeof AlignLeftIcon }[] = [
  { value: 'left', label: 'Align left', icon: AlignLeftIcon },
  { value: 'center', label: 'Align centre', icon: AlignCenterIcon },
  { value: 'right', label: 'Align right', icon: AlignRightIcon },
]

const buttonClass = 'flex size-7 items-center justify-center rounded text-white hover:bg-white/20 focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none aria-pressed:bg-white/30 [&_svg]:size-3.5'

export type QuickTheme = { colors: Record<string, string>; palette: readonly PaletteColor[] }

export function QuickBar({ node, device, theme, onApply }: {
  node: BuilderNode & { style?: ResponsiveStyle }
  device: Device
  theme?: QuickTheme
  onApply: (path: StylePath, value: unknown) => void
}) {
  const [open, setOpen] = useState(false)
  const breakpoint = BREAKPOINT[device]
  const style = node.style ?? {}
  const align = resolveStyleValue<string>(style, breakpoint, ALIGN_PATH)
  const color = resolveStyleValue<string>(style, breakpoint, COLOR_PATH)
  const device_ = DEVICE_LABEL[device].toLowerCase()
  const shown = resolveColor(color.value ?? null, theme?.colors)

  return (
    <div role="group" aria-label={`Text on ${device_}`} className="flex items-center gap-0.5 border-l border-white/30 pl-0.5" data-testid="quick-bar">
      {ALIGNS.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          type="button"
          aria-label={`${label} (${device_})`}
          title={`${label} on ${device_}`}
          aria-pressed={align.value === value}
          className={buttonClass}
          onClick={() => onApply(ALIGN_PATH, align.value === value && align.origin.kind === 'here' ? undefined : value)}
        >
          <Icon aria-hidden />
        </button>
      ))}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button type="button" aria-label={`Text colour (${device_})`} title={`Text colour on ${device_}`} className={buttonClass}>
            <span className="relative flex flex-col items-center">
              <BaselineIcon aria-hidden />
              <span className="mt-px h-1 w-3.5 rounded-sm border border-white/70" style={{ background: shown ?? 'transparent' }} aria-hidden />
            </span>
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72" aria-label="Text colour">
          <div className="flex flex-col gap-3">
            <ColorEditor
              label="Text colour"
              value={color.value ?? null}
              onChange={(next) => onApply(COLOR_PATH, next ?? undefined)}
              themeColors={theme?.colors}
              allowTokens
              palette={theme?.palette ?? []}
            />
            {color.origin.kind === 'here' && (
              <Button type="button" variant="outline" size="sm" onClick={() => onApply(COLOR_PATH, undefined)}>
                {breakpoint === 'base' ? 'Use the theme’s text colour' : 'Same as the wider screens'}
              </Button>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}
