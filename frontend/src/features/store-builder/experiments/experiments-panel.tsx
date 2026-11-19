import { useEffect, useId, useRef, useState } from 'react'
import { CircleAlertIcon, FlaskConicalIcon, PlayIcon, ShieldCheckIcon, SquareIcon, Trash2Icon, TrophyIcon, XIcon } from 'lucide-react'
import { toast } from 'sonner'
import { CHART_THEME_CLASS } from '@/components/common/charts/chart-utils'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { ErrorState, LoadingState } from '@/components/common/state-views'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { formatMoney } from '@/lib/money'
import { cn } from '@/lib/utils'
import type { BuilderContent } from '@/storefront/builder/types'
import { nodeName, useCommands, useEditorUi } from '../commands'
import { formatCount, formatPercent } from '../insights/insights-model'
import { useEditor, useEditorStoreApi } from '../store'
import { ExperimentChart } from './experiment-chart'
import { testNameFor } from './test-name'
import { useExperimentResultsQuery, type ExperimentResults, type ResultsDevice } from './experiments-api'
import { useExperimentsUi } from './experiments-context'
import {
  armSections,
  canHaveExperiments,
  createTest,
  experimentProblems,
  experimentsOf,
  goalWords,
  GOALS,
  NAME_MAX,
  removeTest,
  shownArms,
  SPLIT_MAX,
  SPLIT_MIN,
  SPLIT_STEP,
  startReason,
  STATUS_WORDS,
  testReason,
  updateExperiment,
  type Experiment,
  type ExperimentArm,
  type ExperimentGoal,
} from './experiments-model'
import { CONFIDENCE_WORDS, cumulativeRates, dataProgress, progressText, rateText, recommendationText, resultHeadline } from './results-words'

/*
 * B13 A/B tests panel (in place of the left panel while open, like Insights): each test of the
 * page with its name, goal, split, the two versions (show either on the canvas), start / stop,
 * live results in plain words with the progress towards enough data and a small chart, and
 * Keep A / Keep B. Start, stop and keep need the publish permission; they change the draft and
 * take effect when the page is published.
 */

const DEVICES: { value: ResultsDevice; label: string }[] = [
  { value: 'all', label: 'All devices' },
  { value: 'desktop', label: 'Computers' },
  { value: 'tablet', label: 'Tablets' },
  { value: 'mobile', label: 'Phones' },
]

const STATUS_STYLE: Record<Experiment['status'], string> = {
  draft: 'border-border bg-muted text-foreground',
  running: 'border-emerald-700/30 bg-emerald-50 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100',
  stopped: 'border-amber-700/30 bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-100',
  ended: 'border-border bg-muted text-foreground',
}

function dayText(iso: string | null, timeZone: string | undefined): string | null {
  if (!iso) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  try {
    return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone })
  } catch {
    return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  }
}

type Props = {
  canPublish: boolean
  /** storefront.view: results can be read. */
  canView: boolean
  timeZone: string | undefined
  onClose: () => void
}

export function ExperimentsPanel({ canPublish, canView, timeZone, onClose }: Props) {
  const ui = useExperimentsUi()
  const store = useEditorStoreApi()
  const content = useEditor((s) => s.content)
  const selection = useEditor((s) => s.selection)
  const documentKind = useEditor((s) => s.document.kind)
  const { single = false } = useEditorUi()
  const commands = useCommands()
  const headingRef = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    if (!ui?.focusId) headingRef.current?.focus()
  }, [ui?.focusId])
  if (!ui) return null
  const list = experimentsOf(content)
  const selectedSection = selection && content.sections.some((s) => s.id === selection) ? selection : null
  const selectedReason = selectedSection ? testReason(content, selectedSection, { kind: documentKind, single }) : null

  const testSelected = () => {
    if (!selectedSection) return
    const state = store.getState()
    const result = createTest(state.content, selectedSection, testNameFor(state.content, selectedSection))
    if (!result || !state.apply(() => result.content, { select: result.copyId })) return
    ui.pick(result.experimentId, 'B')
    ui.openTest(result.experimentId)
    commands.reveal(result.copyId)
    toast.success('Version B is a copy of the section, right below it. Change it, then start the test.')
  }

  return (
    <section aria-labelledby="ab-title" className="flex min-h-0 flex-1 flex-col" data-testid="ab-panel">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <h2 id="ab-title" ref={headingRef} tabIndex={-1} className="flex-1 text-sm font-semibold outline-none">
          A/B tests
        </h2>
        <Button type="button" variant="ghost" size="icon-sm" aria-label="Close A/B tests" title="Close" onClick={onClose}>
          <XIcon />
        </Button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-3 py-3">
        <p className="text-sm text-muted-foreground">Show some shoppers a different version of a section and see which one gets more orders. Each shopper always sees the same version.</p>
        {!canHaveExperiments(documentKind) || single ? (
          <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">A/B tests are for pages and shop areas.</p>
        ) : list.length === 0 ? (
          <div className="flex flex-col gap-2 rounded-md border border-dashed p-3 text-sm" data-testid="ab-empty">
            <p className="font-medium">No tests on this page yet.</p>
            <p className="text-muted-foreground">Select a section, open its ⋯ menu and choose “Test a different version”.</p>
            {selectedSection && (
              <Button type="button" size="sm" className="self-start" disabled={selectedReason !== null} onClick={testSelected}>
                <FlaskConicalIcon data-icon="inline-start" /> Test the selected section
              </Button>
            )}
            {selectedReason && <p className="text-xs text-muted-foreground">{selectedReason}</p>}
          </div>
        ) : (
          list.map((experiment) => <TestCard key={experiment.id} experiment={experiment} content={content} canPublish={canPublish} canView={canView} timeZone={timeZone} />)
        )}
        <p className="mt-auto flex items-start gap-1.5 pt-2 text-xs text-muted-foreground">
          <ShieldCheckIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          Shoppers are split in their own browser, without cookies or personal details. People who ask not to be tracked always see version A and aren’t counted.
        </p>
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------------------- one test ---- */

function TestCard({ experiment, content, canPublish, canView, timeZone }: { experiment: Experiment; content: BuilderContent; canPublish: boolean; canView: boolean; timeZone: string | undefined }) {
  const ui = useExperimentsUi()!
  const store = useEditorStoreApi()
  const selection = useEditor((s) => s.selection)
  const published = useEditor((s) => s.document.published)
  const { registry, globals } = useEditorUi()
  const commands = useCommands()
  const ref = useRef<HTMLElement>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const ids = useId()
  const [removeOpen, setRemoveOpen] = useState(false)
  const id = experiment.id
  const focused = ui.focusId === id
  useEffect(() => {
    if (!focused) return
    ref.current?.scrollIntoView?.({ block: 'nearest' })
    headingRef.current?.focus()
  }, [focused])

  const arms = armSections(content, id)
  const shown = shownArms(content, ui.picked, selection)[id] ?? 'A'
  const problems = experimentProblems(content, id)
  const running = experiment.status === 'running'
  const ended = experiment.status === 'ended'
  const locked = running || ended
  const busy = ui.pending?.startsWith(`${id}:`) ?? false
  const live = running && experiment.started_at !== null && published?.published_at != null && Date.parse(published.published_at) >= Date.parse(experiment.started_at)
  const edit = (patch: Parameters<typeof updateExperiment>[2], key: string) => store.getState().apply((c) => updateExperiment(c, id, patch), { coalesceKey: `ab:${id}:${key}` })
  const nameOf = (sectionId: string) => {
    const section = content.sections.find((s) => s.id === sectionId)
    return section ? nodeName(section, registry, globals) : 'Section'
  }
  const show = (arm: ExperimentArm) => {
    ui.pick(id, arm)
    const first = arms[arm][0]
    if (first) {
      store.getState().select(first)
      commands.reveal(first)
    }
  }
  const start = startReason(content, experiment)
  const permission = canPublish ? null : 'Only people who may publish can start, stop or finish tests.'

  const statusNote = (() => {
    switch (experiment.status) {
      case 'draft':
        return 'Not started. Shoppers see version A; version B is only in your draft.'
      case 'running':
        return live
          ? `Running since ${dayText(experiment.started_at, timeZone) ?? 'it was published'}. ${experiment.split}\u00a0% of shoppers see version B.`
          : `Starts when you publish the page. Then ${experiment.split}\u00a0% of shoppers see version B.`
      case 'stopped':
        return `Stopped${dayText(experiment.ended_at, timeZone) ? ` on ${dayText(experiment.ended_at, timeZone)}` : ''}. Once published, every shopper sees version ${experiment.winner ?? 'A'} until you keep one.`
      case 'ended':
        return `Finished${dayText(experiment.ended_at, timeZone) ? ` on ${dayText(experiment.ended_at, timeZone)}` : ''}. You kept version ${experiment.winner ?? 'A'}.`
    }
  })()

  return (
    <article ref={ref} aria-labelledby={`${ids}-title`} className={cn('flex flex-col gap-3 rounded-md border p-3', focused && 'ring-2 ring-ring')} data-testid={`ab-test-${id}`}>
      <div className="flex items-start gap-2">
        <FlaskConicalIcon className="mt-0.5 size-4 shrink-0 text-violet-700 dark:text-violet-300" aria-hidden />
        <h3 id={`${ids}-title`} ref={headingRef} tabIndex={-1} className="min-w-0 flex-1 text-sm font-semibold break-words outline-none">
          {experiment.name}
        </h3>
        <Badge variant="outline" className={cn('shrink-0', STATUS_STYLE[experiment.status])} data-testid="ab-status">
          {STATUS_WORDS[experiment.status]}
        </Badge>
      </div>
      <p className="text-xs text-muted-foreground" data-testid="ab-status-note">{statusNote}</p>

      <div className="flex flex-col gap-1">
        <Label htmlFor={`${ids}-name`} className="text-xs">Name</Label>
        <Input id={`${ids}-name`} className="h-8" value={experiment.name} maxLength={NAME_MAX} onChange={(e) => edit({ name: e.target.value }, 'name')} onBlur={(e) => !e.target.value.trim() && edit({ name: 'Test' }, 'name')} />
      </div>

      {!ended && (
        <div className="flex flex-col gap-1.5" role="group" aria-label="Versions">
          <span className="text-xs font-medium">Versions</span>
          {(['A', 'B'] as const).map((arm) => (
            <div key={arm} className="flex items-center gap-2 text-xs">
              <span aria-hidden className={cn('h-4 w-0.5 shrink-0 rounded', arm === 'A' ? 'bg-violet-600 dark:bg-violet-400' : 'bg-teal-700 dark:bg-teal-400')} />
              <span className="min-w-0 flex-1 truncate">
                <span className="font-semibold">Version {arm}</span>
                {arm === 'A' ? ' (the original)' : ''}: {arms[arm].length === 0 ? <span className="text-destructive">no sections</span> : `${nameOf(arms[arm][0]!)}${arms[arm].length > 1 ? ` + ${arms[arm].length - 1} more` : ''}`}
              </span>
              <Button type="button" variant={shown === arm ? 'secondary' : 'outline'} size="xs" aria-pressed={shown === arm} disabled={arms[arm].length === 0} onClick={() => show(arm)} aria-label={`Show version ${arm} on the canvas`}>
                {shown === arm ? 'Showing' : 'Show'}
              </Button>
            </div>
          ))}
        </div>
      )}

      {!ended && (
        <div className="grid grid-cols-1 gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor={`${ids}-goal`} className="text-xs">What counts as better</Label>
            <Select value={experiment.goal} disabled={locked} onValueChange={(value) => edit({ goal: value as ExperimentGoal }, 'goal')}>
              <SelectTrigger id={`${ids}-goal`} size="sm" className="w-full" data-testid="ab-goal"><SelectValue /></SelectTrigger>
              <SelectContent>
                {GOALS.map((g) => <SelectItem key={g.value} value={g.value}>{g.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <Label htmlFor={`${ids}-split`} className="text-xs">Shoppers who see version B</Label>
              <output htmlFor={`${ids}-split`} className="text-xs font-semibold tabular-nums" data-testid="ab-split-value">{experiment.split}{'\u00a0'}%</output>
            </div>
            <input
              id={`${ids}-split`}
              type="range"
              min={SPLIT_MIN}
              max={SPLIT_MAX}
              step={SPLIT_STEP}
              value={experiment.split}
              disabled={locked}
              aria-valuetext={`${experiment.split}\u00a0% see version B, ${100 - experiment.split}\u00a0% see version A`}
              onChange={(e) => edit({ split: Number(e.target.value) }, 'split')}
              className="h-6 w-full accent-[var(--primary)] disabled:opacity-50"
              data-testid="ab-split"
            />
            <span className="text-xs text-muted-foreground">{100 - experiment.split}{'\u00a0'}% see version A. Half and half finds a winner fastest.</span>
          </div>
          {running && <p className="text-xs text-muted-foreground">Stop the test to change the goal or the split — changing them while it runs would mix up the results.</p>}
        </div>
      )}

      {problems.length > 0 && !ended && (
        <ul className="flex flex-col gap-1 rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs" aria-label="Problems with this test" data-testid="ab-problems">
          {problems.map((p) => (
            <li key={p} className="flex items-start gap-1.5">
              <CircleAlertIcon className="mt-0.5 size-3.5 shrink-0 text-destructive" aria-hidden /> {p}
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap gap-2">
        {(experiment.status === 'draft' || experiment.status === 'stopped') && (
          <Button type="button" size="sm" disabled={busy} aria-disabled={permission ?? start ? true : undefined} title={permission ?? start ?? undefined} onClick={() => (permission ?? start ? toast.info((permission ?? start)!) : void ui.run(id, { kind: 'start' }))} data-testid="ab-start">
            <PlayIcon data-icon="inline-start" /> {experiment.status === 'stopped' ? 'Start again' : 'Start test'}
          </Button>
        )}
        {running && (
          <Button type="button" size="sm" variant="outline" disabled={busy} aria-disabled={permission ? true : undefined} title={permission ?? undefined} onClick={() => (permission ? toast.info(permission) : void ui.run(id, { kind: 'stop' }))} data-testid="ab-stop">
            <SquareIcon data-icon="inline-start" /> Stop test
          </Button>
        )}
        {(experiment.status === 'draft' || ended) && (
          <Button type="button" size="sm" variant="ghost" onClick={() => setRemoveOpen(true)} data-testid="ab-remove">
            <Trash2Icon data-icon="inline-start" /> {ended ? 'Remove from the list' : 'Remove test'}
          </Button>
        )}
      </div>
      {(permission ?? start) && (experiment.status === 'draft' || experiment.status === 'stopped') && <p className="text-xs text-muted-foreground">{permission ?? start}</p>}

      {experiment.status !== 'draft' &&
        (canView ? (
          <Results experiment={experiment} canPublish={canPublish} busy={busy} />
        ) : (
          <p className="text-xs text-muted-foreground">Results are for people who may see the store’s insights.</p>
        ))}

      <ConfirmDialog
        open={removeOpen}
        onOpenChange={setRemoveOpen}
        title={ended ? 'Remove this test from the list?' : 'Remove this test?'}
        description={ended ? 'Its results are no longer shown here. The page stays as it is.' : 'Version B’s sections are deleted and version A stays as a normal section. Undo brings the test back.'}
        confirmLabel={ended ? 'Remove from the list' : 'Remove test'}
        onConfirm={() => {
          setRemoveOpen(false)
          store.getState().apply((c) => removeTest(c, id, ended ? (experiment.winner ?? 'A') : 'A'))
          toast.success(ended ? 'Test removed from the list.' : 'Test removed. Version A stays on the page.')
        }}
      />
      <span className="sr-only" aria-live="polite">{busy ? 'Working…' : ''}</span>
    </article>
  )
}

/* ------------------------------------------------------------------------------- results ----- */

function Results({ experiment, canPublish, busy }: { experiment: Experiment; canPublish: boolean; busy: boolean }) {
  const ui = useExperimentsUi()!
  const documentId = useEditor((s) => s.document.id)
  const [device, setDevice] = useState<ResultsDevice>('all')
  const [keep, setKeep] = useState<ExperimentArm | null>(null)
  const ids = useId()
  const query = useExperimentResultsQuery(documentId, experiment.id, device, experiment.goal, true)
  const data = query.data
  const ended = experiment.status === 'ended'

  return (
    <div className="flex flex-col gap-3 border-t pt-3" data-testid="ab-results">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-sm font-semibold">Results</h4>
        <Label htmlFor={`${ids}-device`} className="sr-only">Device</Label>
        <Select value={device} onValueChange={(v) => setDevice(v as ResultsDevice)}>
          <SelectTrigger id={`${ids}-device`} size="sm" className="w-36" data-testid="ab-device"><SelectValue /></SelectTrigger>
          <SelectContent>
            {DEVICES.map((d) => <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      {query.isPending && !data ? (
        <LoadingState rows={3} label="Loading results" />
      ) : query.error && !data ? (
        <ErrorState title="Results couldn’t be loaded" error={query.error} onRetry={() => void query.refetch()} />
      ) : data ? (
        <div className={cn('flex flex-col gap-3 transition-opacity motion-reduce:transition-none', query.isFetching && 'opacity-60')} aria-busy={query.isFetching || undefined}>
          <ResultFigures results={data} goal={experiment.goal} />
          {!ended && experiment.status !== 'draft' && (
            <div className="flex flex-col gap-2">
              <p className="text-sm" data-testid="ab-recommendation">{recommendationText(data)}</p>
              <div className="grid grid-cols-2 gap-2">
                {(['A', 'B'] as const).map((arm) => {
                  const suggested = data.enough_data && data.recommendation === (arm === 'A' ? 'keep_a' : 'keep_b')
                  const reason = canPublish ? null : 'Only people who may publish can finish a test.'
                  return (
                    <Button
                      key={arm}
                      type="button"
                      size="sm"
                      variant={suggested ? 'default' : 'outline'}
                      disabled={busy}
                      aria-disabled={reason ? true : undefined}
                      title={reason ?? undefined}
                      onClick={() => (reason ? toast.info(reason) : setKeep(arm))}
                      data-testid={`ab-keep-${arm}`}
                    >
                      {suggested && <TrophyIcon data-icon="inline-start" />} Keep {arm}
                      {suggested && <span className="sr-only"> (suggested)</span>}
                    </Button>
                  )
                })}
              </div>
            </div>
          )}
          <ConfirmDialog
            open={keep !== null}
            onOpenChange={(open) => !open && setKeep(null)}
            title={`Keep version ${keep ?? ''}?`}
            description={
              <>
                Version {keep === 'A' ? 'B' : 'A'}’s sections are removed from the draft and the test finishes. Every shopper sees version {keep} once you publish.
                {!data.enough_data && <strong className="mt-2 block font-medium">There isn’t enough data yet, so this is a guess, not a result.</strong>}
              </>
            }
            confirmLabel={`Keep version ${keep ?? ''}`}
            destructive={false}
            onConfirm={() => {
              const arm = keep
              setKeep(null)
              if (arm) void ui.run(experiment.id, { kind: 'keep', arm })
            }}
          />
        </div>
      ) : null}
    </div>
  )
}

function ResultFigures({ results, goal }: { results: ExperimentResults; goal: ExperimentGoal }) {
  const words = goalWords(goal)
  const progress = dataProgress(results)
  const percent = Math.round(progress * 100)
  const empty = results.arms.A.visitors === 0 && results.arms.B.visitors === 0
  return (
    <div className="flex flex-col gap-3">
      <p className="text-base leading-snug font-semibold" data-testid="ab-headline" aria-live="polite">{resultHeadline(results, goal)}</p>
      {results.enough_data && (
        <p className="text-xs text-muted-foreground" data-testid="ab-confidence">
          How sure: <span className="font-medium text-foreground">{CONFIDENCE_WORDS[results.confidence]}</span>
        </p>
      )}
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between text-xs">
          <span id={`ab-progress-${goal}`} className="font-medium">Enough data to decide</span>
          <span className="tabular-nums">{results.enough_data ? 'Yes' : `${percent}\u00a0%`}</span>
        </div>
        <div
          role="progressbar"
          aria-labelledby={`ab-progress-${goal}`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          aria-valuetext={results.enough_data ? 'Enough data' : `${percent}\u00a0% of the data needed`}
          className="h-2 overflow-hidden rounded-full bg-muted"
          data-testid="ab-progress"
        >
          <span className="block h-full rounded-full bg-primary transition-[width] motion-reduce:transition-none" style={{ width: `${percent}%` }} />
        </div>
        <p className="text-xs text-muted-foreground">{progressText(results, goal)}</p>
      </div>
      {!empty && (
        <table className={cn('w-full text-xs', CHART_THEME_CLASS)} aria-label="Results by version">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th scope="col" className="py-1 pr-2 font-medium">Version</th>
              <th scope="col" className="px-1 py-1 text-right font-medium">Visitors</th>
              <th scope="col" className="px-1 py-1 text-right font-medium capitalize">{words.noun}</th>
              <th scope="col" className="px-1 py-1 text-right font-medium">Rate</th>
              <th scope="col" className="py-1 pl-1 text-right font-medium">Sales</th>
            </tr>
          </thead>
          <tbody>
            {(['A', 'B'] as const).map((arm) => {
              const a = results.arms[arm]
              return (
                <tr key={arm} className="border-t" data-testid={`ab-row-${arm}`}>
                  <th scope="row" className="py-1 pr-2 text-left font-semibold">
                    <span className="flex items-center gap-1.5">
                      <svg width="10" height="4" aria-hidden className="shrink-0"><line x1="0" x2="10" y1="2" y2="2" stroke={arm === 'A' ? 'var(--viz-1)' : 'var(--viz-2)'} strokeWidth="2" strokeLinecap="round" /></svg>
                      {arm}
                    </span>
                  </th>
                  <td className="px-1 py-1 text-right tabular-nums">{formatCount(a.visitors)}</td>
                  <td className="px-1 py-1 text-right tabular-nums">{formatCount(a.goal_count)}</td>
                  <td className="px-1 py-1 text-right tabular-nums" title={rateText(a.rate, goal)}>{a.rate === null ? '—' : formatPercent(a.rate)}</td>
                  <td className="py-1 pl-1 text-right tabular-nums">{formatMoney(a.revenue, results.currency ?? undefined)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
      {!empty && results.daily.length > 0 && (
        <div className="flex flex-col gap-1">
          <h5 className="text-xs font-semibold">Share of visitors who {words.did}, so far</h5>
          <ExperimentChart title={`Share of visitors who ${words.did}, so far, by version`} points={cumulativeRates(results.daily)} />
          <p className="text-xs text-muted-foreground">Each day counts everyone since the test started, so the lines settle as more people visit.</p>
        </div>
      )}
    </div>
  )
}
