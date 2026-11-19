import { FlaskConicalIcon } from 'lucide-react'
import type { Rect } from '@/storefront/builder/canvas/protocol'
import { cn } from '@/lib/utils'
import type { ExperimentArm } from './experiments-model'

/*
 * B13: on the canvas, each A/B test's sections carry a small switch at their bottom right —
 * "A/B test · Showing version A | B". The canvas draws one version at a time (the editor leaves
 * the other version's sections out of the render), so this is how the owner sees and edits each.
 */

export type ArmSwitchTest = {
  id: string
  name: string
  shown: ExperimentArm
  /** The shown version's section ids (where the switch goes). */
  ids: string[]
  /** Versions that have sections. */
  has: Record<ExperimentArm, boolean>
}

export type ArmSwitchLayer = {
  tests: ArmSwitchTest[]
  onShow: (experimentId: string, arm: ExperimentArm) => void
}

const PILL_HEIGHT = 30

export function ArmSwitchers({ layer, rects, scale, height }: { layer: ArmSwitchLayer; rects: Record<string, Rect>; scale: number; height: number }) {
  return (
    <>
      {layer.tests.map((test) => {
        const drawn = test.ids.map((id) => rects[id]).filter((r): r is Rect => r !== undefined && r.h > 0)
        if (drawn.length === 0) return null
        const left = Math.min(...drawn.map((r) => r.x)) * scale
        const right = Math.max(...drawn.map((r) => r.x + r.w)) * scale
        const top = Math.min(...drawn.map((r) => r.y)) * scale
        const bottom = Math.max(...drawn.map((r) => r.y + r.h)) * scale
        // Bottom right inside the test's sections; kept on screen while the section runs past the view.
        const y = Math.max(top + 6, Math.min(bottom - PILL_HEIGHT - 6, height - PILL_HEIGHT - 8))
        if (y > height || bottom < 0) return null
        return (
          <div key={test.id} className="pointer-events-none absolute flex justify-end" style={{ left, width: right - left, top: y }}>
            <div
              role="group"
              aria-label={`A/B test “${test.name}”: version shown on the canvas`}
              data-testid={`arm-switch-${test.id}`}
              className="pointer-events-auto mr-1.5 flex items-center gap-1 rounded-full bg-violet-800 py-0.5 pr-0.5 pl-2 text-xs text-white shadow-lg"
            >
              <FlaskConicalIcon className="size-3.5 shrink-0" aria-hidden />
              <span className="whitespace-nowrap">Showing version</span>
              {(['A', 'B'] as const).map((arm) => (
                <button
                  key={arm}
                  type="button"
                  aria-pressed={test.shown === arm}
                  aria-label={`Version ${arm}`}
                  disabled={!test.has[arm]}
                  title={test.has[arm] ? `Show version ${arm}` : `Version ${arm} has no sections`}
                  onClick={() => layer.onShow(test.id, arm)}
                  className={cn(
                    'flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 font-semibold focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-1 focus-visible:ring-offset-violet-800 focus-visible:outline-none disabled:opacity-50',
                    test.shown === arm ? 'bg-white text-violet-900' : 'text-white hover:bg-white/20',
                  )}
                >
                  {arm}
                </button>
              ))}
            </div>
          </div>
        )
      })}
    </>
  )
}
