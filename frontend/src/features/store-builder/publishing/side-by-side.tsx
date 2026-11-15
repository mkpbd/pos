import { useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { ArrowRightLeftIcon, EyeIcon, Loader2Icon, MinusIcon, MonitorIcon, PencilIcon, PlusIcon, SmartphoneIcon, TabletIcon } from 'lucide-react'
import { ErrorState } from '@/components/common/state-views'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import type { CanvasSurroundings } from '@/storefront/builder/canvas/protocol'
import type { CanvasThemeSettings } from '@/storefront/builder/canvas/theme-override'
import type { Device, RenderPageSection } from '@/storefront/builder/types'
import type { StorefrontBootstrap } from '@/storefront/types'
import type { CompareNode, CompareResult, RenderPayload } from '../publishing-api'
import { CHANGE_KIND_LABEL, changeCountText, changeItems, type ChangeItem, type ChangeKind } from './changes'
import { ReadOnlyCanvas, type ReadOnlyCanvasHandle } from './read-only-canvas'

/*
 * B11: two read-only canvases next to each other (before on the left, after on the right) and the
 * list of what changed. "Show" outlines a change on both canvases and scrolls them to it; the
 * canvases scroll together unless the owner turns that off. Used by Compare (version history) and
 * by the review screen.
 */

export type Side =
  | { status: 'loading' }
  | { status: 'error'; error: unknown; retry?: () => void }
  | { status: 'empty'; text: string }
  | { status: 'ready'; payload: RenderPayload }

export type ChangesState = { status: 'loading' } | { status: 'error'; error: unknown; retry?: () => void } | { status: 'ready'; result: CompareResult }

type Props = {
  bootstrap: StorefrontBootstrap
  surroundings?: CanvasSurroundings
  emptyText?: string
  theme?: CanvasThemeSettings | null
  left: { title: ReactNode; label: string; side: Side }
  right: { title: ReactNode; label: string; side: Side }
  changes: ChangesState
  /** Element type → its name ("Heading"). */
  typeLabel: (type: string) => string
}

const DEVICES: { device: Device; label: string; icon: typeof MonitorIcon }[] = [
  { device: 'desktop', label: 'Desktop', icon: MonitorIcon },
  { device: 'tablet', label: 'Tablet', icon: TabletIcon },
  { device: 'mobile', label: 'Mobile', icon: SmartphoneIcon },
]

const KIND_ICON: Record<ChangeKind, typeof PlusIcon> = { added: PlusIcon, removed: MinusIcon, changed: PencilIcon, moved: ArrowRightLeftIcon }
const KIND_BADGE: Record<ChangeKind, 'success' | 'destructive' | 'info' | 'soft'> = { added: 'success', removed: 'destructive', changed: 'info', moved: 'soft' }

/** Every node of a render payload by id, with a label (for moved nodes the server names by id only). */
function nodesOf(sides: Side[]): Map<string, CompareNode> {
  const map = new Map<string, CompareNode>()
  const visit = (node: { id?: unknown; type?: unknown; props?: unknown; columns?: unknown; elements?: unknown }) => {
    if (typeof node.id === 'string' && typeof node.type === 'string' && !map.has(node.id)) {
      const props = (node.props ?? {}) as Record<string, unknown>
      const text = [props.text, props.title, props.label, props.alt].find((v) => typeof v === 'string' && v.trim() !== '') as string | undefined
      map.set(node.id, { node_id: node.id, type: node.type, label: text ?? null })
    }
    for (const column of (Array.isArray(node.columns) ? node.columns : []) as { elements?: unknown[] }[]) {
      for (const element of (column.elements ?? []) as Parameters<typeof visit>[0][]) visit(element)
    }
  }
  for (const side of sides) if (side.status === 'ready') for (const section of side.payload.sections as RenderPageSection[]) visit(section as Parameters<typeof visit>[0])
  return map
}

function SidePane({ title, label, side, children }: { title: ReactNode; label: string; side: Side; children: (payload: RenderPayload) => ReactNode }) {
  return (
    <section aria-label={label} className="flex min-h-0 min-w-0 flex-1 flex-col border-r last:border-r-0">
      <div className="flex min-h-10 items-center gap-2 border-b bg-background px-3 py-1.5 text-sm font-medium">{title}</div>
      {side.status === 'ready' ? (
        children(side.payload)
      ) : side.status === 'loading' ? (
        <div role="status" className="flex flex-1 items-center justify-center gap-2 bg-muted/60 text-sm text-muted-foreground">
          <Loader2Icon className="size-4 animate-spin" aria-hidden /> Loading {label.toLowerCase()}…
        </div>
      ) : side.status === 'error' ? (
        <div className="flex flex-1 items-center justify-center bg-muted/60 p-4">
          <ErrorState title={`Could not load ${label.toLowerCase()}`} error={side.error} onRetry={side.retry} />
        </div>
      ) : (
        <p className="flex flex-1 items-center justify-center bg-muted/60 p-6 text-center text-sm text-muted-foreground">{side.text}</p>
      )}
    </section>
  )
}

export function ChangeList({ changes, typeLabel, lookup, shown, onShow }: { changes: ChangesState; typeLabel: (type: string) => string; lookup?: (id: string) => CompareNode | null; shown: string | null; onShow?: (item: ChangeItem) => void }) {
  const headingId = useId()
  const items = useMemo(() => (changes.status === 'ready' ? changeItems(changes.result, typeLabel, lookup) : []), [changes, typeLabel, lookup])
  return (
    <section aria-labelledby={headingId} className="flex min-h-0 flex-col" data-testid="change-list">
      <h3 id={headingId} className="flex items-center justify-between gap-2 border-b px-3 py-2 text-sm font-semibold">
        What changed
        {changes.status === 'ready' && <span className="text-xs font-normal text-muted-foreground">{changeCountText(items.length)}</span>}
      </h3>
      {changes.status === 'loading' ? (
        <p role="status" className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
          <Loader2Icon className="size-4 animate-spin" aria-hidden /> Finding the changes…
        </p>
      ) : changes.status === 'error' ? (
        <div className="p-3">
          <ErrorState title="Could not list the changes" error={changes.error} onRetry={changes.retry} />
        </div>
      ) : items.length === 0 ? (
        <p className="p-3 text-sm text-muted-foreground">Both look the same: nothing was added, removed or changed.</p>
      ) : (
        <ul className="min-h-0 flex-1 divide-y overflow-y-auto" aria-label="Changes">
          {items.map((item) => {
            const Icon = KIND_ICON[item.kind]
            const active = item.nodeId !== null && item.nodeId === shown
            return (
              <li key={item.key} className={cn('flex flex-col gap-1 px-3 py-2', active && 'bg-primary/8')} data-testid={`change-${item.kind}`}>
                <div className="flex items-start gap-2">
                  <Badge variant={KIND_BADGE[item.kind]} className="mt-0.5">
                    <Icon aria-hidden /> {item.badge ?? CHANGE_KIND_LABEL[item.kind]}
                  </Badge>
                  <span className="min-w-0 flex-1 text-sm font-medium break-words">{item.title}</span>
                  {onShow && item.nodeId && (
                    <Button type="button" variant="ghost" size="sm" className="h-7 shrink-0 px-2" aria-pressed={active} aria-label={`Show ${(item.badge ?? CHANGE_KIND_LABEL[item.kind]).toLowerCase()}: ${item.title}`} onClick={() => onShow(item)}>
                      <EyeIcon aria-hidden /> Show
                    </Button>
                  )}
                </div>
                {item.details.length > 0 && (
                  <ul className="flex flex-col gap-0.5 pl-1 text-xs text-muted-foreground">
                    {item.details.map((line, index) => (
                      <li key={index} className="break-words">
                        {line}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

export function SideBySide({ bootstrap, surroundings = 'page', emptyText, theme, left, right, changes, typeLabel }: Props) {
  const [device, setDevice] = useState<Device>('desktop')
  const [together, setTogether] = useState(true)
  const [shown, setShown] = useState<{ id: string; title: string } | null>(null)
  const leftRef = useRef<ReadOnlyCanvasHandle>(null)
  const rightRef = useRef<ReadOnlyCanvasHandle>(null)
  const togetherId = useId()
  const nodes = useMemo(() => nodesOf([left.side, right.side]), [left.side, right.side])
  const lookup = useMemo(() => (id: string) => nodes.get(id) ?? null, [nodes])

  const canvas = (which: 'left' | 'right', label: string) => (payload: RenderPayload) => (
    <ReadOnlyCanvas
      label={label}
      bootstrap={bootstrap}
      payload={payload}
      device={device}
      surroundings={surroundings}
      emptyText={emptyText}
      theme={theme}
      highlight={shown?.id ?? null}
      handleRef={which === 'left' ? leftRef : rightRef}
      onScroll={(dy) => {
        if (together) (which === 'left' ? rightRef : leftRef).current?.scrollBy(dy)
      }}
    />
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col lg:flex-row" data-testid="side-by-side">
      <div className="flex min-h-[60vh] min-w-0 flex-1 flex-col lg:min-h-0">
        <div className="flex flex-wrap items-center gap-3 border-b px-3 py-1.5">
          <div role="group" aria-label="Preview width" className="flex items-center gap-1">
            {DEVICES.map(({ device: value, label, icon: Icon }) => (
              <Button key={value} type="button" size="icon-sm" variant={device === value ? 'secondary' : 'ghost'} aria-pressed={device === value} aria-label={`${label} view`} title={label} onClick={() => setDevice(value)}>
                <Icon />
              </Button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Checkbox id={togetherId} checked={together} onCheckedChange={(v) => setTogether(v === true)} />
            <Label htmlFor={togetherId} className="text-sm font-normal">
              Scroll both together
            </Label>
          </div>
          <p className="sr-only" role="status" aria-live="polite">
            {shown ? `Showing ${shown.title} on both previews.` : ''}
          </p>
        </div>
        <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
          <SidePane title={left.title} label={left.label} side={left.side}>
            {canvas('left', left.label)}
          </SidePane>
          <SidePane title={right.title} label={right.label} side={right.side}>
            {canvas('right', right.label)}
          </SidePane>
        </div>
      </div>
      <aside aria-label="Changes between the two" className="flex max-h-[40vh] min-h-0 w-full shrink-0 flex-col border-t bg-background lg:max-h-none lg:w-80 lg:border-t-0 lg:border-l">
        <ChangeList
          changes={changes}
          typeLabel={typeLabel}
          lookup={lookup}
          shown={shown?.id ?? null}
          onShow={(item) => {
            if (!item.nodeId) return
            const id = item.nodeId
            setShown((current) => (current?.id === id ? null : { id, title: item.title }))
            leftRef.current?.scrollTo(id)
            rightRef.current?.scrollTo(id)
          }}
        />
      </aside>
    </div>
  )
}
