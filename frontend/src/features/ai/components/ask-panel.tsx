import { useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { Link } from 'react-router'
import { ArrowRightIcon, BotOffIcon, Loader2Icon, SendHorizontalIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { AI_PERMISSIONS, MAX_QUESTION_LENGTH, aiEnabledFor, useAskMutation, type AnswerReport, type AskAnswer, type ToolUse } from '@/features/ai/api'
import { AiBranchSelect, AiErrorAlert } from '@/features/ai/components/ai-states'
import { SafeMarkdown } from '@/features/ai/components/safe-markdown'
import { useAuth, useCan } from '@/features/auth/use-auth'
import { ReportTable } from '@/features/reports/components/report-table'
import { displayText } from '@/features/reports/format'

/** Starting points; questions in Bangla work the same way (sent as typed). */
const EXAMPLE_QUESTIONS = [
  'What were my best-selling products last week?',
  'How do this month’s sales compare with last month?',
  'Which items are low on stock?',
  'Show sales by branch for last month',
  'গত সপ্তাহে সবচেয়ে বেশি বিক্রি হওয়া পণ্য কোনগুলো?',
]

const numberFormat = new Intl.NumberFormat('en-US')

/** Ask tab: one question at a time, answered from the organization's reports. */
export function AskPanel() {
  const me = useAuth()
  const ask = useAskMutation()
  const [question, setQuestion] = useState('')
  const [branchId, setBranchId] = useState<string | null>(null)
  const [asked, setAsked] = useState<string | null>(null)
  const [validation, setValidation] = useState<string | null>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const id = useId()

  if (!aiEnabledFor(me)) return <AskUnavailable />

  const submit = (text: string) => {
    const trimmed = text.trim()
    if (trimmed.length < 2) {
      setValidation('Type a question first.')
      inputRef.current?.focus()
      return
    }
    if (trimmed.length > MAX_QUESTION_LENGTH) {
      setValidation(`Keep the question under ${MAX_QUESTION_LENGTH} characters.`)
      return
    }
    setValidation(null)
    setAsked(trimmed)
    ask.mutate({ question: trimmed, branch_id: branchId })
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (!ask.isPending) submit(question)
  }

  // Enter sends, Shift+Enter adds a line. Never while an input method (e.g. Bangla) is composing.
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      if (!ask.isPending) submit(question)
    }
  }

  const askExample = (text: string) => {
    setQuestion(text)
    if (!ask.isPending) submit(text)
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle><h2>Ask about your business</h2></CardTitle>
          <CardDescription>
            Answers come only from your reports (sales, stock, purchasing, finance and customers you may see). Ask in English or Bangla.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} noValidate className="flex flex-col gap-3" aria-label="Ask AI">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${id}-question`}>Your question</Label>
              <Textarea
                id={`${id}-question`}
                ref={inputRef}
                rows={3}
                lang="mul"
                dir="auto"
                value={question}
                maxLength={MAX_QUESTION_LENGTH}
                placeholder="e.g. What were my best-selling products last week?"
                aria-invalid={validation ? true : undefined}
                aria-describedby={`${id}-hint`}
                onChange={(e) => {
                  setQuestion(e.target.value)
                  if (validation) setValidation(null)
                }}
                onKeyDown={onKeyDown}
              />
              <p id={`${id}-hint`} className={validation ? 'text-sm text-destructive' : 'text-xs text-muted-foreground'}>
                {validation ?? 'Press Enter to ask, Shift+Enter for a new line.'}
              </p>
            </div>
            <div className="flex flex-wrap items-end justify-between gap-3">
              <AiBranchSelect id={`${id}-branch`} value={branchId} onChange={setBranchId} />
              <Button type="submit" disabled={ask.isPending} className="ml-auto">
                {ask.isPending ? <Loader2Icon data-icon="inline-start" className="animate-spin" /> : <SendHorizontalIcon data-icon="inline-start" />}
                Ask
              </Button>
            </div>
          </form>
          <div className="mt-4 flex flex-col gap-2">
            <p className="text-xs font-medium text-muted-foreground" id={`${id}-examples`}>Try one of these</p>
            <ul className="flex flex-wrap gap-2" aria-labelledby={`${id}-examples`}>
              {EXAMPLE_QUESTIONS.map((q) => (
                <li key={q}>
                  <Button type="button" variant="outline" size="sm" className="h-auto min-h-8 py-1 text-left whitespace-normal" disabled={ask.isPending} onClick={() => askExample(q)}>
                    {q}
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        </CardContent>
      </Card>

      {/* Answers are announced to screen readers when they arrive. */}
      <section aria-label="Answer" aria-live="polite" aria-busy={ask.isPending} className="flex flex-col gap-4">
        {ask.isPending ? (
          <div role="status" className="flex items-center gap-2 rounded-lg border p-4 text-sm text-muted-foreground">
            <Loader2Icon className="size-4 animate-spin" aria-hidden /> Looking through your reports…
          </div>
        ) : ask.isError ? (
          <AiErrorAlert error={ask.error} />
        ) : ask.data && asked ? (
          <AnswerCard question={asked} answer={ask.data} />
        ) : null}
      </section>
    </div>
  )
}

function AskUnavailable() {
  const can = useCan()
  return (
    <div role="note" data-testid="ask-unavailable" className="flex gap-3 rounded-lg border border-dashed p-6 text-sm">
      <BotOffIcon className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
      <div className="flex flex-col gap-1">
        <p className="font-medium">The AI assistant is turned off for your organization</p>
        <p className="text-muted-foreground">Reports and the dashboard answer the same questions without AI. {can(AI_PERMISSIONS.insights) ? 'Business and customer insights on this page still show their figures.' : ''}</p>
        {can(AI_PERMISSIONS.manage) && <p><Link to="/organization#ai-settings" className="font-medium underline underline-offset-4">Turn on AI in Organization settings</Link></p>}
      </div>
    </div>
  )
}

function AnswerCard({ question, answer }: { question: string; answer: AskAnswer }) {
  const me = useAuth()
  return (
    <Card data-testid="ai-answer">
      <CardHeader>
        <CardTitle><h2 className="text-base">Answer</h2></CardTitle>
        <CardDescription dir="auto">You asked: “{question}”</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {answer.answer ? <SafeMarkdown text={answer.answer} /> : <p className="text-sm text-muted-foreground">The assistant did not return an answer. Try rephrasing the question.</p>}
        {answer.truncated && <p className="text-xs text-muted-foreground">The answer reached its length limit and may be cut short; ask a narrower question for the rest.</p>}
        {answer.report && <AnswerReportView report={answer.report} timeZone={me.organization?.timezone} currency={me.organization?.base_currency} />}
        {answer.tools_used.length > 0 && <ToolsUsed tools={answer.tools_used} />}
        {answer.usage && (
          <p className="text-xs text-muted-foreground" data-testid="ai-usage">
            Used {numberFormat.format(answer.usage.input_tokens)} input and {numberFormat.format(answer.usage.output_tokens)} output tokens of your organization’s AI budget.
          </p>
        )}
      </CardContent>
    </Card>
  )
}

function AnswerReportView({ report, timeZone, currency }: { report: AnswerReport; timeZone?: string; currency?: string }) {
  const can = useCan()
  const canOpen = can('reports.view') || can('reports.financial')
  if (report.columns.length === 0) return null
  const more = report.total_rows !== null && report.total_rows > report.rows.length
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium">{report.title}</h3>
        {canOpen && report.link && (
          <Button asChild variant="outline" size="sm">
            <Link to={report.link}>Open full report <ArrowRightIcon data-icon="inline-end" /></Link>
          </Button>
        )}
      </div>
      {report.rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">The report has no rows for this period.</p>
      ) : (
        <ReportTable title={report.title} columns={report.columns} rows={report.rows} totals={report.totals} sort={null} onSort={() => undefined} timeZone={timeZone} note={currency ? `Amounts in ${currency}` : undefined} />
      )}
      <p className="text-xs text-muted-foreground">
        {currency ? `Amounts in ${currency}. ` : ''}
        {more ? `Showing the first ${report.rows.length} of ${report.total_rows} rows.` : report.rows.length >= 50 ? `Showing the first ${report.rows.length} rows.` : ''}
      </p>
    </div>
  )
}

function paramText(value: unknown): string {
  if (Array.isArray(value)) return value.map(paramText).join(', ')
  if (value !== null && typeof value === 'object') return displayText(value)
  return value === null || value === undefined || value === '' ? '—' : String(value)
}

function ToolsUsed({ tools }: { tools: ToolUse[] }) {
  return (
    <details className="group rounded-md border px-3 py-2 text-sm" data-testid="ai-tools-used">
      <summary className="cursor-pointer font-medium select-none">
        How this was answered ({tools.length} {tools.length === 1 ? 'lookup' : 'lookups'})
      </summary>
      <ul className="mt-2 flex flex-col gap-2">
        {tools.map((tool, i) => (
          <li key={i} className="flex flex-col gap-1">
            <span className="flex flex-wrap items-center gap-2">
              <code className="w-fit rounded bg-muted px-1 py-0.5 font-mono text-xs">{tool.name}</code>
              {!tool.ok && <Badge variant="warning">Not run</Badge>}
            </span>
            {Object.keys(tool.params).length > 0 && (
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                {Object.entries(tool.params).map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="font-mono">{k}</dt>
                    <dd className="break-all">{paramText(v)}</dd>
                  </div>
                ))}
              </dl>
            )}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-muted-foreground">The assistant can only run the organization’s predefined reports with your permissions; it never changes data.</p>
    </details>
  )
}
