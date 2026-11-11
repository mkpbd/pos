/*
 * Advanced tab of a section or element: devices it shows on, hidden, schedule (edited in the
 * organization's timezone, stored as ISO 8601 with offset) and, for sections, the anchor.
 */

import { MonitorIcon, SmartphoneIcon, TabletIcon } from 'lucide-react'
import { FormField } from '@/components/common/form-field'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { useCurrentUserQuery } from '@/features/auth/api'
import { fromZonedInput, toZonedInput } from '@/features/promotions/zoned-time'
import { cn } from '@/lib/utils'
import type { Device, Element, Schedule, Section } from '@/storefront/builder/types'
import { FieldError, type Errors } from './fields'
import type { InspectorChangeOptions } from './types'

const DEVICES: { device: Device; label: string; Icon: typeof MonitorIcon }[] = [
  { device: 'desktop', label: 'Desktop', Icon: MonitorIcon },
  { device: 'tablet', label: 'Tablet', Icon: TabletIcon },
  { device: 'mobile', label: 'Mobile', Icon: SmartphoneIcon },
]

/** Lower case, spaces → dashes, anything else outside `[a-z0-9-]` dropped. */
function toAnchor(text: string): string {
  return text.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
}

export function AdvancedTab<N extends Section | Element>({ node, onChange, errors, takenAnchors }: {
  node: N
  onChange: (next: N, opts?: InspectorChangeOptions) => void
  errors: Errors
  /** Anchors of the other sections (sections only). */
  takenAnchors?: Set<string>
}) {
  const me = useCurrentUserQuery()
  const timeZone = me.data?.organization?.timezone
  const schedule = node.schedule
  const noun = node.type === 'section' ? 'section' : 'element'

  const setSchedule = (key: 'starts_at' | 'ends_at', local: string) => {
    const next = { starts_at: schedule?.starts_at ?? null, ends_at: schedule?.ends_at ?? null, [key]: fromZonedInput(local, timeZone) }
    const value: Schedule = next.starts_at === null && next.ends_at === null ? null : next
    onChange({ ...node, schedule: value })
  }

  const shownOn = DEVICES.filter((d) => node.visibility[d.device])
  const anchor = node.type === 'section' ? (node as Section).props.anchor : null
  const anchorTaken = anchor !== null && takenAnchors?.has(anchor)

  return (
    <div className="flex flex-col gap-6">
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1.5 text-sm font-medium">Show on</legend>
        <div className="flex gap-2" role="group" aria-label="Devices">
          {DEVICES.map(({ device, label, Icon }) => {
            const on = node.visibility[device]
            return (
              <button
                key={device}
                type="button"
                aria-pressed={on}
                aria-label={`Show on ${label.toLowerCase()}`}
                title={on ? `Shown on ${label.toLowerCase()}; click to hide there` : `Hidden on ${label.toLowerCase()}; click to show there`}
                onClick={() => onChange({ ...node, visibility: { ...node.visibility, [device]: !on } })}
                className={cn(
                  'flex flex-1 flex-col items-center gap-1 rounded-md border px-2 py-2 text-xs outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50',
                  on ? 'border-primary bg-primary/10 text-foreground' : 'text-muted-foreground line-through',
                )}
              >
                <Icon className="size-4" aria-hidden />
                {label}
              </button>
            )
          })}
        </div>
        <p className="text-sm text-muted-foreground">
          {shownOn.length === 3 ? 'Shown on every device.' : shownOn.length === 0 ? `Hidden on every device: visitors never see this ${noun}.` : `Only on ${shownOn.map((d) => d.label.toLowerCase()).join(' and ')}.`}
        </p>
        <FieldError message={errors.visibility} />
      </fieldset>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <Switch id={`hidden-${node.id}`} checked={node.hidden} onCheckedChange={(hidden) => onChange({ ...node, hidden })} />
          <Label htmlFor={`hidden-${node.id}`}>Hide from visitors</Label>
        </div>
        <p className="text-sm text-muted-foreground">Stays on the page in the editor (faded) but visitors don’t see it.</p>
      </div>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1.5 text-sm font-medium">Schedule</legend>
        <FormField label="Show from" error={errors.starts_at} hint={timeZone ? `Optional. Time in ${timeZone}.` : 'Optional.'}>
          <Input type="datetime-local" value={toZonedInput(schedule?.starts_at, timeZone)} onChange={(e) => setSchedule('starts_at', e.target.value)} />
        </FormField>
        <FormField label="Show until" error={errors.ends_at} hint="Optional.">
          <Input type="datetime-local" value={toZonedInput(schedule?.ends_at, timeZone)} onChange={(e) => setSchedule('ends_at', e.target.value)} />
        </FormField>
      </fieldset>

      {node.type === 'section' && (
        <FormField
          label="Anchor"
          error={errors.anchor ?? (anchorTaken ? 'Another section already uses this anchor.' : undefined)}
          hint={anchor ? `Link to this section with #${anchor} (e.g. ${'/#'}${anchor}).` : 'Optional: a name to link straight to this section, e.g. offers.'}
        >
          <Input
            maxLength={60}
            spellCheck={false}
            placeholder="offers"
            value={anchor ?? ''}
            onChange={(e) => {
              const value = toAnchor(e.target.value)
              const section = node as Section
              onChange({ ...section, props: { ...section.props, anchor: value === '' ? null : value } } as N, { coalesceKey: `${node.id}:anchor` })
            }}
          />
        </FormField>
      )}
    </div>
  )
}
