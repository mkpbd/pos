import { FlaskConicalIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useEditor } from '../store'
import { useExperimentsUi } from './experiments-context'
import { armIndex, experimentsOf, shownArms, STATUS_WORDS } from './experiments-model'

/*
 * B13: Layers groups the versions of an A/B test — a line above the test's first section ("A/B
 * test: Hero test · Running", Open), a "Version A / B" tag on each section of the test and a rail
 * down the left of them. The version the canvas isn't showing is marked "not on the canvas".
 */

export function ArmGroupHeader({ nodeId }: { nodeId: string }) {
  const ui = useExperimentsUi()
  const content = useEditor((s) => s.content)
  if (!ui) return null
  const index = armIndex(content)
  const arm = index.get(nodeId)
  if (!arm) return null
  const first = content.sections.find((s) => index.get(s.id)?.id === arm.id)
  if (first?.id !== nodeId) return null
  const experiment = experimentsOf(content).find((e) => e.id === arm.id)
  if (!experiment) return null
  return (
    <div className="flex h-7 items-center gap-1.5 pr-1 pl-2 text-xs" data-testid={`ab-group-${experiment.id}`}>
      <FlaskConicalIcon className="size-3.5 shrink-0 text-violet-700 dark:text-violet-300" aria-hidden />
      <span className="min-w-0 truncate font-medium">A/B test: {experiment.name}</span>
      <span className="shrink-0 text-muted-foreground">· {STATUS_WORDS[experiment.status]}</span>
      <button
        type="button"
        onClick={() => ui.openTest(experiment.id)}
        className="ml-auto shrink-0 rounded px-1.5 py-0.5 font-medium text-primary underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        aria-label={`Open the A/B test “${experiment.name}”`}
      >
        Open
      </button>
    </div>
  )
}

export function ArmTag({ nodeId }: { nodeId: string }) {
  const ui = useExperimentsUi()
  const content = useEditor((s) => s.content)
  const selection = useEditor((s) => s.selection)
  if (!ui) return null
  const arm = armIndex(content).get(nodeId)
  if (!arm) return null
  const shown = shownArms(content, ui.picked, selection)[arm.id] === arm.arm
  return (
    <>
      <span aria-hidden className={cn('absolute top-0 bottom-0 left-0 w-0.5 rounded', arm.arm === 'A' ? 'bg-violet-600 dark:bg-violet-400' : 'bg-teal-700 dark:bg-teal-400')} />
      <span
        data-testid={`arm-tag-${nodeId}`}
        title={shown ? `Version ${arm.arm} of the A/B test` : `Version ${arm.arm} of the A/B test — the canvas shows the other version now`}
        className={cn(
          'shrink-0 rounded px-1 py-0.5 text-[10px] leading-none font-semibold',
          !shown
            ? 'border border-dashed border-current bg-transparent text-foreground'
            : arm.arm === 'A'
              ? 'bg-violet-100 text-violet-900 dark:bg-violet-900/50 dark:text-violet-100'
              : 'bg-teal-100 text-teal-900 dark:bg-teal-900/50 dark:text-teal-100',
        )}
      >
        <span className="sr-only">, </span>
        {arm.arm === 'A' ? 'Version A' : 'Version B'}
        {!shown && <span className="sr-only"> (not on the canvas now)</span>}
      </span>
    </>
  )
}
