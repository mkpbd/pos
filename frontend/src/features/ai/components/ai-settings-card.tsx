import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { useLocation } from 'react-router'
import { Loader2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { ErrorState, LoadingState } from '@/components/common/state-views'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { FEATURE_LABELS, useAiSettingsQuery, useAiUsageQuery, useUpdateAiSettingsMutation, type AiSettings, type AiUsage } from '@/features/ai/api'
import { formatMonth } from '@/features/supplier-performance/performance'
import { ApiError } from '@/lib/api/client'

const numberFormat = new Intl.NumberFormat('en-US')
const MAX_BUDGET = 10_000_000_000

/** Organization → AI assistant (ai.manage): switch, monthly token budget and this month's usage. */
export function AiSettingsCard() {
  const settings = useAiSettingsQuery()
  const usage = useAiUsageQuery()
  const ref = useRef<HTMLDivElement>(null)
  const location = useLocation()
  const ready = !settings.isPending

  // Links from the AI pages land on this card.
  useEffect(() => {
    if (ready && location.hash === '#ai-settings') ref.current?.scrollIntoView?.({ block: 'start' })
  }, [ready, location.hash])

  return (
    <Card id="ai-settings" ref={ref} className="scroll-mt-20">
      <CardHeader>
        <CardTitle><h2>AI assistant</h2></CardTitle>
        <CardDescription>
          Optional. AI answers questions and writes summaries from aggregated report figures only — it reads, never changes data. Customer names and phone numbers are never sent to the AI service.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {settings.isPending ? (
          <LoadingState rows={3} label="Loading AI settings" />
        ) : settings.error ? (
          <ErrorState error={settings.error} onRetry={() => settings.refetch()} />
        ) : (
          <SettingsForm key={JSON.stringify(settings.data)} settings={settings.data} />
        )}
        <section aria-labelledby="ai-usage-heading" className="flex flex-col gap-3">
          <h3 id="ai-usage-heading" className="text-sm font-semibold">Usage this month</h3>
          {usage.isPending ? (
            <LoadingState rows={2} label="Loading AI usage" />
          ) : usage.error ? (
            <ErrorState error={usage.error} onRetry={() => usage.refetch()} />
          ) : (
            <UsageView usage={usage.data} />
          )}
        </section>
      </CardContent>
    </Card>
  )
}

function SettingsForm({ settings }: { settings: AiSettings }) {
  const id = useId()
  const update = useUpdateAiSettingsMutation()
  const [enabled, setEnabled] = useState(settings.enabled)
  const [budget, setBudget] = useState(settings.monthly_token_budget === null ? '' : String(settings.monthly_token_budget))
  const [error, setError] = useState<string | null>(null)

  const parsed = budget.trim() === '' ? null : /^\d+$/.test(budget.trim()) ? Number(budget.trim()) : NaN
  const dirty = enabled !== settings.enabled || parsed !== settings.monthly_token_budget
  const defaultBudget = settings.default_monthly_token_budget

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (parsed !== null && (!Number.isInteger(parsed) || parsed > MAX_BUDGET)) {
      setError(`Enter a whole number of tokens between 0 and ${numberFormat.format(MAX_BUDGET)}, or leave it empty.`)
      return
    }
    setError(null)
    update.mutate(
      { enabled, monthly_token_budget: parsed },
      {
        onSuccess: () => toast.success('AI settings saved.'),
        onError: (err) => setError(err instanceof ApiError ? (err.fieldErrors.monthly_token_budget?.[0] ?? err.fieldErrors.enabled?.[0] ?? err.message) : 'Could not save the AI settings.'),
      },
    )
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4" aria-label="AI settings">
      {!settings.available && (
        <p role="note" className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
          AI is switched off for this installation (no AI provider is configured). The organization setting takes effect once the administrator of the server enables it.
        </p>
      )}
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${id}-enabled`}>Enable AI for this organization</Label>
          <p className="text-sm text-muted-foreground" id={`${id}-enabled-hint`}>When off, Ask AI and reorder explanations are unavailable; insight figures still show without the AI summary.</p>
        </div>
        <Switch id={`${id}-enabled`} checked={enabled} onCheckedChange={setEnabled} aria-describedby={`${id}-enabled-hint`} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${id}-budget`}>Monthly token budget</Label>
          <Input
            id={`${id}-budget`}
            inputMode="numeric"
            placeholder={defaultBudget !== null ? `Default: ${numberFormat.format(defaultBudget)}` : 'Application default'}
            value={budget}
            aria-invalid={error ? true : undefined}
            aria-describedby={`${id}-budget-hint`}
            onChange={(e) => {
              setBudget(e.target.value)
              if (error) setError(null)
            }}
          />
          <p id={`${id}-budget-hint`} className={error ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'}>
            {error ?? 'Leave empty for the application default; 0 means no limit. Requests stop for the rest of the month once it is used up.'}
          </p>
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-sm leading-none font-medium">Data shared with the AI service</span>
          <p className="text-sm text-muted-foreground">{settings.data_sharing_level === 'aggregates' ? 'Aggregates only — totals, top-N lists and trends. No customer contact details or full ledgers.' : settings.data_sharing_level}</p>
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" disabled={!dirty || update.isPending} onClick={() => { setEnabled(settings.enabled); setBudget(settings.monthly_token_budget === null ? '' : String(settings.monthly_token_budget)); setError(null) }}>
          Discard
        </Button>
        <Button type="submit" disabled={!dirty || update.isPending}>
          {update.isPending && <Loader2Icon data-icon="inline-start" className="animate-spin" />}
          Save AI settings
        </Button>
      </div>
    </form>
  )
}

function UsageView({ usage }: { usage: AiUsage }) {
  const limited = usage.budget !== null && usage.budget > 0
  const percent = limited ? Math.min(100, Math.round((usage.total_tokens / (usage.budget as number)) * 100)) : null
  return (
    <div className="flex flex-col gap-3">
      <dl className="grid grid-cols-1 gap-3 text-sm min-[400px]:grid-cols-3">
        <div className="rounded-md border p-3">
          <dt className="text-xs text-muted-foreground">Tokens used{usage.month ? ` in ${formatMonth(usage.month)}` : ''}</dt>
          <dd className="font-mono text-lg font-semibold" data-testid="ai-usage-tokens">{numberFormat.format(usage.total_tokens)}</dd>
        </div>
        <div className="rounded-md border p-3">
          <dt className="text-xs text-muted-foreground">Budget</dt>
          <dd className="font-mono text-lg font-semibold">{limited ? numberFormat.format(usage.budget as number) : 'No limit'}</dd>
        </div>
        <div className="rounded-md border p-3">
          <dt className="text-xs text-muted-foreground">Requests</dt>
          <dd className="font-mono text-lg font-semibold">{numberFormat.format(usage.requests)}</dd>
        </div>
      </dl>
      {percent !== null && (
        <div className="flex flex-col gap-1">
          <div role="progressbar" aria-label="Monthly token budget used" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} className="h-2 overflow-hidden rounded-full bg-muted">
            <div className={percent >= 90 ? 'h-full bg-destructive' : percent >= 75 ? 'h-full bg-warning' : 'h-full bg-primary'} style={{ width: `${percent}%` }} />
          </div>
          <p className="text-xs text-muted-foreground">{percent}% of this month’s budget used ({numberFormat.format(usage.input_tokens)} input, {numberFormat.format(usage.output_tokens)} output tokens).</p>
        </div>
      )}
      {usage.by_feature.length > 0 ? (
        <div className="overflow-x-auto rounded-md border">
          <Table aria-label="AI usage by feature">
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Feature</TableHead>
                <TableHead scope="col" className="text-right">Requests</TableHead>
                <TableHead scope="col" className="text-right">Tokens</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {usage.by_feature.map((f) => (
                <TableRow key={f.feature}>
                  <TableCell>{FEATURE_LABELS[f.feature] ?? f.feature.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())}</TableCell>
                  <TableCell className="text-right font-mono">{numberFormat.format(f.requests)}</TableCell>
                  <TableCell className="text-right font-mono">{numberFormat.format(f.tokens)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No AI requests this month.</p>
      )}
    </div>
  )
}
