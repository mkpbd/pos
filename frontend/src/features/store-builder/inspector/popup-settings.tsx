/*
 * B8b: the Popup settings panel (the inspector when nothing is selected in a popup document):
 * on / off, how it looks (layout, size, corner, dimmed page), when it shows (trigger), how often
 * (frequency), where (pages, devices, who), its schedule, priority and a name for screen readers.
 * Plain words; every choice is a native control with a visible label. Settings live in
 * `content.popup` (versioned with the draft); the on / off switch is the document's.
 */

import { useId, type ReactNode } from 'react'
import { InfoIcon, PlusIcon, Trash2Icon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import type { PopupLayout, PopupSettings } from '@/storefront/builder/types'
import { B8B_LIMITS, B8B_TEXT_LIMITS } from '@/storefront/builder/validate'
import type { PopupStatus } from '../api'
import { hasOverlay, hasWidth, isBar, popupProblems, popupStatus, withLayout, withPagesKind } from '../popup-model'
import { PopupSketch } from '../popup-visuals'
import { FieldError, NodeBangla } from './fields'
import { NumberField } from './form-kit'
import { ChoiceField, TextField, ToggleField, ZonedDateTimeField } from './pickers'
import type { InspectorCommand, InspectorDocument, Problem } from './types'

const POPUP_LAYOUT_LABELS: Record<PopupLayout, { label: string; hint: string }> = {
  modal: { label: 'Popup in the middle', hint: 'Over the page, which is dimmed behind it.' },
  slide_in: { label: 'Box in a corner', hint: 'A small box that slides in; shoppers can keep browsing.' },
  bar_top: { label: 'Bar at the top', hint: 'A slim bar above the page.' },
  bar_bottom: { label: 'Bar at the bottom', hint: 'A slim bar below the page.' },
  fullscreen: { label: 'Full screen', hint: 'Covers the whole screen.' },
}

const LAYOUTS: PopupLayout[] = ['modal', 'slide_in', 'bar_top', 'bar_bottom', 'fullscreen']

const STATUS_TEXT: Record<PopupStatus, { label: string; variant: 'success' | 'info' | 'soft'; text: string }> = {
  live: { label: 'Live', variant: 'success', text: 'Shoppers see the published version.' },
  scheduled: { label: 'Scheduled', variant: 'info', text: 'It is switched on and starts at the scheduled time.' },
  off: { label: 'Switched off', variant: 'soft', text: 'It is published but shoppers don’t see it.' },
  expired: { label: 'Ended', variant: 'soft', text: 'Its schedule has ended.' },
  draft: { label: 'Not published', variant: 'soft', text: 'Publish it, then switch it on.' },
}

/** Problem paths that have a field in this panel. */
const FIELD_KEY = /^popup\.(trigger\.(delay_seconds|scroll_percent)|frequency\.days|priority|label|starts_at|ends_at|pages\.paths(\.\d+)?|translations\.bn\.label)$/

function shownField(p: PopupSettings, path: string): boolean {
  if (path === 'popup.trigger.scroll_percent') return p.trigger.kind === 'on_scroll'
  if (path === 'popup.trigger.delay_seconds') return p.trigger.kind !== 'on_scroll'
  if (path === 'popup.frequency.days') return p.frequency.kind === 'once_every_days'
  if (path.startsWith('popup.pages.paths')) return p.pages.kind === 'paths'
  if (path === 'popup.translations.bn.label') return p.label !== ''
  return true
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  const id = useId()
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3 border-t pt-4">
      <h3 id={id} className="text-sm font-semibold">
        {title}
      </h3>
      {children}
    </section>
  )
}

function LayoutPicker({ value, position, onChange }: { value: PopupLayout; position: PopupSettings['position']; onChange: (layout: PopupLayout) => void }) {
  const name = useId()
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1.5 text-sm font-medium">Kind</legend>
      <div className="grid grid-cols-2 gap-2" data-testid="popup-layouts">
        {LAYOUTS.map((layout) => (
          <label
            key={layout}
            className={cn(
              'flex cursor-pointer flex-col gap-1.5 rounded-md border p-1.5 text-xs transition-colors has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50',
              value === layout ? 'border-primary bg-primary/5 font-medium' : 'hover:bg-muted/50',
            )}
            title={POPUP_LAYOUT_LABELS[layout].hint}
          >
            <input type="radio" name={name} value={layout} checked={value === layout} onChange={() => onChange(layout)} className="sr-only" />
            <PopupSketch layout={layout} position={position} />
            {POPUP_LAYOUT_LABELS[layout].label}
          </label>
        ))}
      </div>
      <p className="text-sm text-muted-foreground">{POPUP_LAYOUT_LABELS[value].hint}</p>
    </fieldset>
  )
}

/** "Show on" addresses (`pages.paths`): one box each, lower case, at most 20. */
function PathsField({ paths, errors, onChange }: { paths: string[]; errors: Record<string, string>; onChange: (paths: string[], typing?: string) => void }) {
  const id = useId()
  const max = B8B_LIMITS.popupPaths.max
  return (
    <fieldset className="flex flex-col gap-2" aria-describedby={`${id}-hint`}>
      <legend className="mb-1 text-sm font-medium">Page addresses</legend>
      <p id={`${id}-hint`} className="text-sm text-muted-foreground">
        The popup shows on these pages and the pages under them, e.g. <span className="font-mono">/p/eid-sale</span> or <span className="font-mono">/category/sweets</span>.
      </p>
      <ol className="flex flex-col gap-2">
        {paths.map((path, i) => {
          const error = errors[`popup.pages.paths.${i}`]
          return (
            <li key={i} className="flex flex-col gap-1">
              <div className="flex items-center gap-1">
                <Input
                  aria-label={`Page address ${i + 1}`}
                  value={path}
                  spellCheck={false}
                  placeholder="/p/eid-sale"
                  maxLength={121}
                  aria-invalid={error ? true : undefined}
                  className="font-mono"
                  onChange={(e) => onChange(paths.map((p, j) => (j === i ? e.target.value.toLowerCase().replace(/\s+/g, '') : p)), `path-${i}`)}
                />
                <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove page address ${i + 1}`} onClick={() => onChange(paths.filter((_, j) => j !== i))}>
                  <Trash2Icon />
                </Button>
              </div>
              <FieldError message={error} />
            </li>
          )
        })}
      </ol>
      <FieldError message={errors['popup.pages.paths']} />
      <Button type="button" variant="outline" size="sm" className="self-start" disabled={paths.length >= max} onClick={() => onChange([...paths, '/'])}>
        <PlusIcon data-icon="inline-start" /> Add a page address
      </Button>
    </fieldset>
  )
}

export function PopupSettingsPanel({ settings, document, problems, bangla, onCommand }: {
  settings: PopupSettings
  document: InspectorDocument
  /** Server problems of the document (`popup.…` paths are this panel's). */
  problems: Problem[]
  bangla: boolean
  onCommand: (command: InspectorCommand) => void
}) {
  const p = settings
  const set = (next: PopupSettings, coalesceKey?: string) => onCommand({ type: 'set-popup', settings: next, ...(coalesceKey ? { coalesceKey: `popup:${coalesceKey}` } : {}) })
  const server = Object.fromEntries(problems.filter((x) => FIELD_KEY.test(x.path)).map((x) => [x.path, x.message]))
  const errors: Record<string, string> = { ...server, ...popupProblems(p) }
  const status = popupStatus({ published: document.published, active: document.active, popup: { layout: p.layout, trigger: p.trigger.kind, starts_at: p.starts_at, ends_at: p.ends_at } })
  const statusInfo = STATUS_TEXT[status]
  const canSwitch = document.canPublish === true && !document.activePending && (document.active === true || document.published !== null)
  const switchHint = document.canPublish !== true ? 'Only people allowed to publish can switch it on or off.' : document.published === null && !document.active ? 'Publish it first, then switch it on.' : statusInfo.text
  // Problems without a field here (or of a field the current choices hide) are listed on top.
  const other = problems.filter((x) => !FIELD_KEY.test(x.path) || !shownField(p, x.path))

  return (
    <div className="flex flex-col gap-4 p-4" data-testid="popup-settings">
      <div>
        <h2 className="text-base font-semibold">Popup settings</h2>
        <p className="text-sm text-muted-foreground">How and when shoppers see “{document.title}”. Select something in the popup to edit it.</p>
      </div>

      {other.length > 0 && (
        <ul role="alert" className="list-disc rounded-md border border-destructive/50 bg-destructive/5 p-3 pl-7 text-sm">
          {other.map((x, i) => <li key={`${x.path}-${i}`}>{x.message}</li>)}
        </ul>
      )}

      <div className="flex flex-col gap-2 rounded-md border p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium">On your shop</span>
          <Badge variant={statusInfo.variant} data-testid="popup-panel-status">{statusInfo.label}</Badge>
        </div>
        <ToggleField label="Show on shop" checked={document.active === true} disabled={!canSwitch} hint={switchHint} onChange={(active) => onCommand({ type: 'set-popup-active', active })} />
        <p className="text-xs text-muted-foreground">Switching on or off takes effect at once; the settings below go live when you publish.</p>
      </div>

      <Group title="How it looks">
        <LayoutPicker value={p.layout} position={p.position} onChange={(layout) => set(withLayout(p, layout))} />
        {hasWidth(p.layout) && (
          <ChoiceField
            label="Size"
            value={p.width}
            options={[{ value: 'sm', label: 'Small' }, { value: 'md', label: 'Medium' }, { value: 'lg', label: 'Large' }]}
            onChange={(width) => set({ ...p, width })}
          />
        )}
        {p.layout === 'slide_in' && (
          <ChoiceField label="Corner" value={p.position} options={[{ value: 'bottom_left', label: 'Bottom left' }, { value: 'bottom_right', label: 'Bottom right' }]} onChange={(position) => set({ ...p, position })} />
        )}
        {hasOverlay(p.layout) && (
          <>
            <ToggleField label="Dim the page behind" checked={p.overlay} onChange={(overlay) => set({ ...p, overlay })} />
            <ToggleField label="Close when the shopper clicks outside it" checked={p.close_on_overlay} onChange={(close_on_overlay) => set({ ...p, close_on_overlay })} />
          </>
        )}
        <p className="flex gap-2 text-sm text-muted-foreground">
          <InfoIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
          {isBar(p.layout)
            ? 'Bars move the page instead of covering it, so the cart button stays reachable. A close (×) button is always there.'
            : 'A close (×) button is always there, and the Esc key closes it too.'}
        </p>
      </Group>

      <Group title="When it shows">
        <ChoiceField
          label="Show it when"
          value={p.trigger.kind}
          options={[
            { value: 'on_load', label: 'When a page opens' },
            { value: 'on_scroll', label: 'When the shopper scrolls down' },
            { value: 'on_exit', label: 'When the shopper is about to leave' },
          ]}
          onChange={(kind) => set({ ...p, trigger: { ...p.trigger, kind, ...(kind === 'on_exit' && p.trigger.kind !== 'on_exit' && p.trigger.delay_seconds < 10 ? { delay_seconds: 20 } : {}) } })}
        />
        {p.trigger.kind === 'on_load' && (
          <NumberField
            label="Wait (seconds)"
            value={p.trigger.delay_seconds}
            min={B8B_LIMITS.popupDelay.min}
            max={B8B_LIMITS.popupDelay.max}
            hint="0 shows it at once. A few seconds gives shoppers time to look around first."
            error={errors['popup.trigger.delay_seconds']}
            onChange={(delay_seconds) => set({ ...p, trigger: { ...p.trigger, delay_seconds } }, 'delay')}
          />
        )}
        {p.trigger.kind === 'on_scroll' && (
          <NumberField
            label="After scrolling this far down (%)"
            value={p.trigger.scroll_percent}
            min={B8B_LIMITS.popupScroll.min}
            max={B8B_LIMITS.popupScroll.max}
            hint="50 = halfway down the page."
            error={errors['popup.trigger.scroll_percent']}
            onChange={(scroll_percent) => set({ ...p, trigger: { ...p.trigger, scroll_percent } }, 'scroll')}
          />
        )}
        {p.trigger.kind === 'on_exit' && (
          <NumberField
            label="On phones, show after (seconds)"
            value={p.trigger.delay_seconds}
            min={B8B_LIMITS.popupDelay.min}
            max={B8B_LIMITS.popupDelay.max}
            hint="On a computer it shows when the mouse leaves the page at the top. Phones have no mouse, so it shows after this time instead."
            error={errors['popup.trigger.delay_seconds']}
            onChange={(delay_seconds) => set({ ...p, trigger: { ...p.trigger, delay_seconds } }, 'delay')}
          />
        )}
      </Group>

      <Group title="How often">
        <ChoiceField
          label="How often to show it"
          value={p.frequency.kind}
          options={[
            { value: 'every_page_view', label: 'Every time a page opens' },
            { value: 'once_per_session', label: 'Once per visit' },
            { value: 'once_every_days', label: 'Once every few days' },
            { value: 'once_forever', label: 'Only once' },
          ]}
          onChange={(kind) => set({ ...p, frequency: { ...p.frequency, kind } })}
        />
        {p.frequency.kind === 'once_every_days' && (
          <NumberField
            label="Every how many days"
            value={p.frequency.days}
            min={B8B_LIMITS.popupDays.min}
            max={B8B_LIMITS.popupDays.max}
            hint="7 = at most once a week for each shopper."
            error={errors['popup.frequency.days']}
            onChange={(days) => set({ ...p, frequency: { ...p.frequency, days } }, 'days')}
          />
        )}
        <ToggleField
          label="Stop showing it after the shopper uses it"
          hint="Once they used its button or sent its form, they don’t see it again."
          checked={p.stop_after_action}
          onChange={(stop_after_action) => set({ ...p, stop_after_action })}
        />
      </Group>

      <Group title="Where and to whom">
        <ChoiceField
          label="On which pages"
          value={p.pages.kind}
          options={[
            { value: 'all', label: 'Every page' },
            { value: 'home', label: 'Home page only' },
            { value: 'shop', label: 'Shop and product pages' },
            { value: 'paths', label: 'Pages I choose' },
          ]}
          onChange={(kind) => set(withPagesKind(p, kind))}
        />
        {p.pages.kind === 'paths' && <PathsField paths={p.pages.paths} errors={errors} onChange={(paths, typing) => set({ ...p, pages: { ...p.pages, paths } }, typing)} />}
        <p className="text-sm text-muted-foreground">Never on the cart, checkout, account or order pages, so it doesn’t get in the way of buying.</p>
        <ChoiceField
          label="On which devices"
          value={p.devices}
          options={[
            { value: 'all', label: 'Computers and phones' },
            { value: 'desktop', label: 'Computers only' },
            { value: 'mobile', label: 'Phones only' },
          ]}
          onChange={(devices) => set({ ...p, devices })}
        />
        <ChoiceField
          label="Who sees it"
          value={p.audience}
          options={[
            { value: 'all', label: 'Everyone' },
            { value: 'guests', label: 'Shoppers who are not signed in' },
            { value: 'signed_in', label: 'Signed-in customers only' },
          ]}
          onChange={(audience) => set({ ...p, audience })}
        />
      </Group>

      <Group title="Schedule">
        <ZonedDateTimeField label="Starts" value={p.starts_at} error={errors['popup.starts_at']} hint="Leave empty to start as soon as it is switched on." onChange={(starts_at) => set({ ...p, starts_at })} />
        <ZonedDateTimeField label="Ends" value={p.ends_at} error={errors['popup.ends_at']} hint="Leave empty to keep it running." onChange={(ends_at) => set({ ...p, ends_at })} />
      </Group>

      <Group title="More">
        <NumberField
          label="Priority"
          value={p.priority}
          min={B8B_LIMITS.popupPriority.min}
          max={B8B_LIMITS.popupPriority.max}
          hint="Only one popup shows at a time (bars can share the page). When two are due, the higher number wins (0–100)."
          error={errors['popup.priority']}
          onChange={(priority) => set({ ...p, priority }, 'priority')}
        />
        <TextField
          label="Name for screen readers"
          hint="Optional. Only needed when the popup has no heading."
          value={p.label}
          max={B8B_TEXT_LIMITS.popup.label}
          error={errors['popup.label']}
          onChange={(label) => set({ ...p, label }, 'label')}
        />
        {bangla && p.label !== '' && (
          <NodeBangla
            fields={[{ name: 'label', label: 'Name for screen readers', base: p.label, max: B8B_TEXT_LIMITS.popup.label }]}
            translations={(p.translations ?? {}) as Record<string, Record<string, string>>}
            errors={Object.fromEntries(Object.entries(errors).filter(([k]) => k.startsWith('popup.translations.')).map(([k, v]) => [k.slice('popup.'.length), v]))}
            onChange={(translations) => set({ ...p, translations: translations as PopupSettings['translations'] }, 'label-bn')}
          />
        )}
      </Group>
    </div>
  )
}
