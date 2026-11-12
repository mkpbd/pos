import { RotateCcwIcon } from 'lucide-react'
import type { Breakpoint } from '@/storefront/builder/types'
import { DEVICE_LABEL, DEVICE_OF, type Origin } from './style-model'

/**
 * The per-device indicator of a style value: a filled dot when the value is set for the device
 * being styled (with a reset button: back to the wider device's value, or to the default on
 * desktop), a hollow dot when it is inherited from a wider device, nothing when not set at all.
 */
export function DeviceStatus({ origin, breakpoint, label, inheritsFrom, onReset }: {
  origin: Origin
  /** The breakpoint being edited. */
  breakpoint: Breakpoint
  label: string
  /** Where the value comes from after a reset (null = the default). */
  inheritsFrom: Breakpoint | null
  onReset: () => void
}) {
  const device = DEVICE_LABEL[DEVICE_OF[breakpoint]]
  if (origin.kind === 'default') return null
  if (origin.kind === 'inherited') {
    const from = DEVICE_LABEL[DEVICE_OF[origin.from]]
    return (
      <span
        role="img"
        data-status="inherited"
        aria-label={`${label}: inherited from ${from}`}
        title={`Inherited from ${from}. Change it to set a different value for ${device}.`}
        className="inline-block size-2 rounded-full border-[1.5px] border-muted-foreground/70"
      />
    )
  }
  const target = inheritsFrom ? `the ${DEVICE_LABEL[DEVICE_OF[inheritsFrom]]} value` : 'the default'
  return (
    <>
      <span role="img" data-status="here" aria-label={`${label}: set for ${device}`} title={`Set for ${device}`} className="inline-block size-2 rounded-full bg-primary" />
      <button
        type="button"
        aria-label={`Reset ${label} to ${target}`}
        title={`Reset to ${target}`}
        onClick={onReset}
        className="flex size-5 items-center justify-center rounded text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-3"
      >
        <RotateCcwIcon aria-hidden />
      </button>
    </>
  )
}
