import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { AlertTriangleIcon, BotOffIcon, GaugeIcon, HourglassIcon, SparklesIcon } from 'lucide-react'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { describeAiError, AI_PERMISSIONS } from '@/features/ai/api'
import { useAuth, useCan } from '@/features/auth/use-auth'
import { formatDateCell } from '@/features/reports/format'
import { cn } from '@/lib/utils'

const ALL = '__all__'

/** A failed AI request in plain words (unavailable, budget, rate limit, other). */
export function AiErrorAlert({ error, action }: { error: unknown; action?: ReactNode }) {
  const info = describeAiError(error)
  const can = useCan()
  const Icon = info.kind === 'unavailable' ? BotOffIcon : info.kind === 'budget' ? GaugeIcon : info.kind === 'rate' ? HourglassIcon : AlertTriangleIcon
  return (
    <div role="alert" data-testid={`ai-error-${info.kind}`} className={cn('flex gap-3 rounded-lg border p-4', info.kind === 'other' || info.kind === 'validation' ? 'border-destructive/30 bg-destructive/5' : 'border-warning/40 bg-warning/10')}>
      <Icon className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
      <div className="flex flex-col gap-1 text-sm">
        <p className="font-medium">{info.title}</p>
        <p className="text-muted-foreground">{info.message}</p>
        {info.kind === 'budget' && can(AI_PERMISSIONS.manage) && (
          <p><Link to="/organization#ai-settings" className="font-medium underline underline-offset-4">Open AI settings</Link></p>
        )}
        {action}
      </div>
    </div>
  )
}

/** Shown where an AI narrative would be when AI is off: the facts on the page are still real. */
export function AiOffNotice({ children }: { children?: ReactNode }) {
  const can = useCan()
  return (
    <div role="note" data-testid="ai-off-notice" className="flex gap-3 rounded-lg border border-dashed p-4 text-sm">
      <BotOffIcon className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
      <div className="flex flex-col gap-1">
        <p className="font-medium">AI summaries are turned off</p>
        <p className="text-muted-foreground">{children ?? 'The figures on this page are calculated directly from your sales and stock records.'}</p>
        {can(AI_PERMISSIONS.manage) && (
          <p><Link to="/organization#ai-settings" className="font-medium underline underline-offset-4">Turn on AI in Organization settings</Link></p>
        )}
      </div>
    </div>
  )
}

/** AI is on but no narrative came back (budget used up, service down, nothing to summarize). */
export function NarrativeMissing({ status }: { status: string | null }) {
  const text =
    status === 'budget_exceeded'
      ? 'No AI summary: this month’s AI budget is used up.'
      : status === 'unavailable'
        ? 'No AI summary: the AI service could not be reached.'
        : 'No AI summary for this period.'
  return (
    <p role="note" data-testid="narrative-missing" className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
      {text} The figures below are complete.
    </p>
  )
}

/** "Written by AI" label for narratives; numbers always come from the facts. */
export function AiByline({ generatedAt }: { generatedAt?: string | null }) {
  const me = useAuth()
  return (
    <p className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
      <SparklesIcon className="size-3.5" aria-hidden />
      Written by AI from the figures on this page. Check important decisions against the reports.
      {generatedAt && <span>· Generated {formatDateCell(generatedAt, me.organization?.timezone)}</span>}
    </p>
  )
}

/** Branch filter for AI pages: all of the user's branches, or one. Hidden with a single branch. */
export function AiBranchSelect({ id, value, onChange }: { id: string; value: string | null; onChange: (id: string | null) => void }) {
  const me = useAuth()
  const branches = me.branches.filter((b) => b.is_active)
  if (branches.length < 2) return null
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>Branch</Label>
      <Select value={value ?? ALL} onValueChange={(v) => onChange(v === ALL ? null : v)}>
        <SelectTrigger id={id} className="w-full sm:w-52"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All my branches</SelectItem>
          {branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  )
}
