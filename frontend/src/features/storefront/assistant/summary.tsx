import { ErrorState, LoadingState } from '@/components/common/state-views'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useAssistantSummaryQuery, type SummaryRange } from './api'
import { plural, toolLabel } from './model'

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>{label}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-1">
        <p className="text-2xl font-semibold tabular-nums">{value}</p>
        {note && <p className="text-sm text-muted-foreground">{note}</p>}
      </CardContent>
    </Card>
  )
}

/** AI2b summary cards for the chosen days: chats, messages, hand-offs, standard replies, most used tools. */
export function AssistantSummaryCards({ range }: { range: SummaryRange }) {
  const summary = useAssistantSummaryQuery(range)

  if (summary.isPending) return <LoadingState rows={2} label="Loading the summary" />
  if (summary.isError) return <ErrorState error={summary.error} onRetry={() => summary.refetch()} title="Could not load the summary" />

  const s = summary.data
  const fallbacks = s.unavailable + s.limit + s.budget
  const fallbackParts = [
    s.unavailable > 0 && `${s.unavailable.toLocaleString('en-US')} AI unavailable`,
    s.limit > 0 && `${s.limit.toLocaleString('en-US')} limit reached`,
    s.budget > 0 && `${s.budget.toLocaleString('en-US')} allowance used up`,
  ].filter(Boolean)

  return (
    <section aria-label="Summary" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="assistant-summary">
      <Stat label="Chats" value={s.conversations.toLocaleString('en-US')} note={plural(s.messages, 'message')} />
      <Stat label="Handed off" value={`${s.handed_off_percent}%`} note={`${plural(s.handed_off, 'chat')} sent to WhatsApp or your contact page`} />
      <Stat label="Standard replies" value={fallbacks.toLocaleString('en-US')} note={fallbackParts.length > 0 ? fallbackParts.join(' · ') : 'Every message got an AI answer'} />
      <Card size="sm">
        <CardHeader>
          <CardTitle>Most used lookups</CardTitle>
        </CardHeader>
        <CardContent>
          {s.top_tools.length === 0 ? (
            <p className="text-sm text-muted-foreground">No lookups yet</p>
          ) : (
            <ol className="flex flex-col gap-0.5 text-sm">
              {s.top_tools.slice(0, 3).map((t) => (
                <li key={t.name} className="flex justify-between gap-2">
                  <span className="truncate">{toolLabel(t.name)}</span>
                  <span className="text-muted-foreground tabular-nums">{t.count.toLocaleString('en-US')}</span>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>
    </section>
  )
}
