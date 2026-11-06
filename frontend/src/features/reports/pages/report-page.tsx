import { useEffect, useMemo } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { ArrowLeftIcon, EyeOffIcon } from 'lucide-react'
import { ExportMenu } from '@/components/common/export-menu'
import { PageHeader } from '@/components/common/page-header'
import { PaginationBar } from '@/components/common/pagination-bar'
import { EmptyState, ErrorState, LoadingState } from '@/components/common/state-views'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useAuth, useCan } from '@/features/auth/use-auth'
import { useReportRegistryQuery, useReportRunQuery, type ReportColumn, type ReportDefinition, type ReportRun } from '@/features/reports/api'
import { CHARTED_REPORTS, visibleColumns } from '@/features/reports/columns'
import { PnlStatement } from '@/features/reports/components/pnl-statement'
import { ReportTrendChart } from '@/features/reports/components/report-chart'
import { ReportFilters } from '@/features/reports/components/report-filters'
import { ReportTable } from '@/features/reports/components/report-table'
import { formatDateCell } from '@/features/reports/format'
import { DEFAULT_PER_PAGE, missingDefaults, pageValues, paramsProblem, paramValues, PER_PAGE_OPTIONS, runQuery, sortValue, withChanges } from '@/features/reports/params'
import { toStatement } from '@/features/reports/statement'
import { ApiError } from '@/lib/api/client'

function runErrorMessage(error: unknown): { title: string; message: string } {
  if (error instanceof ApiError) {
    if (error.code === 'RANGE_TOO_LARGE') return { title: 'That period is too long for this report', message: error.message || 'Choose a shorter period, or group by month.' }
    if (error.code === 'VALIDATION_FAILED') {
      const messages = Object.values(error.fieldErrors).flat()
      return { title: 'Check the filters', message: messages.join(' ') || error.message }
    }
    if (error.status === 403) return { title: 'Not allowed', message: 'You do not have permission to run this report.' }
  }
  return { title: 'The report could not be loaded', message: error instanceof Error ? error.message : 'An unexpected error occurred.' }
}

/** /reports/:reportKey — any registry report, rendered from its definition. */
export function ReportPage() {
  const { reportKey = '' } = useParams()
  const registry = useReportRegistryQuery()

  if (registry.isPending) return <LoadingState rows={4} label="Loading report" />
  if (registry.error) return <ErrorState error={registry.error} onRetry={() => registry.refetch()} />

  const definition = registry.data.find((d) => d.key === reportKey)
  if (!definition) {
    return (
      <div className="flex flex-col gap-6">
        <BackLink />
        <EmptyState title="Report not found" description="This report does not exist or you may not run it." action={<Button asChild variant="outline"><Link to="/reports">All reports</Link></Button>} />
      </div>
    )
  }
  return <ReportView key={definition.key} definition={definition} />
}

function BackLink() {
  return (
    <Link to="/reports" className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
      <ArrowLeftIcon className="size-4" aria-hidden /> All reports
    </Link>
  )
}

function ReportView({ definition }: { definition: ReportDefinition }) {
  const me = useAuth()
  const can = useCan()
  const timeZone = me.organization?.timezone
  const [search, setSearch] = useSearchParams()

  // Complete the address with the defaults, so the link always says what is shown.
  useEffect(() => {
    if (missingDefaults(definition, search, timeZone)) {
      // Only fills gaps: paging and everything else in the address stay as they are.
      const next = new URLSearchParams(search)
      for (const [k, v] of Object.entries(paramValues(definition, search, timeZone))) if (!next.get(k)) next.set(k, v)
      setSearch(next, { replace: true })
    }
  }, [definition, search, setSearch, timeZone])

  const values = paramValues(definition, search, timeZone)
  const problem = paramsProblem(definition, values)
  const query = useMemo(() => runQuery(definition, search, timeZone), [definition, search, timeZone])
  const run = useReportRunQuery(definition.key, query, problem === null)
  const { columns, hiddenCost } = visibleColumns(definition, run.data, can('products.view_cost'))
  const statement = definition.layout === 'statement' && run.data ? toStatement(run.data) : null
  const currency = run.data?.currency ?? me.organization?.base_currency ?? null
  const isEmpty = statement ? statement.lines.length === 0 : (run.data?.rows.length ?? 0) === 0
  const { per_page } = pageValues(search)
  const pagination = run.data?.pagination ?? null

  const update = (changes: Record<string, string | null>) => setSearch(withChanges(search, changes), { replace: true })
  const exportQuery = Object.fromEntries(Object.entries(query).filter(([k]) => k !== 'page' && k !== 'per_page'))

  return (
    <div className="flex flex-col gap-4 sm:gap-6">
      <BackLink />
      <PageHeader
        title={definition.title}
        description={definition.description ?? undefined}
        actions={
          <ExportMenu
            list="report"
            pathParams={{ key: definition.key }}
            query={exportQuery}
            title={definition.title}
            disabled={problem !== null || !run.data || isEmpty || run.isFetching}
          />
        }
      />
      <ReportFilters definition={definition} values={values} onChange={update} />

      {problem ? (
        <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">{problem}</p>
      ) : run.isPending ? (
        <LoadingState rows={6} label={`Loading ${definition.title}`} />
      ) : run.error ? (
        <RunError error={run.error} onRetry={() => run.refetch()} />
      ) : (
        <div className={run.isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'} aria-busy={run.isFetching}>
          <div className="flex flex-col gap-4">
            <RunNotes run={run.data} currency={currency} hiddenCost={hiddenCost} timeZone={timeZone} />
            {isEmpty ? (
              <EmptyState title="Nothing to report" description="No records match these filters. Try a longer period or fewer filters." />
            ) : statement ? (
              <PnlStatement title={definition.title} statement={statement} currency={currency} />
            ) : (
              <>
                {CHARTED_REPORTS.has(definition.key) && <ReportTrendChart definition={definition} columns={columns} rows={run.data.rows} partial={(pagination?.last_page ?? 1) > 1} />}
                <ReportTable
                  title={definition.title}
                  columns={columns}
                  rows={run.data.rows}
                  totals={definition.has_totals || run.data.totals ? run.data.totals : null}
                  sort={sortValue(definition, search)}
                  onSort={(sort) => update({ sort })}
                  timeZone={timeZone}
                  note={currency ? `Amounts in ${currency}` : undefined}
                />
                {pagination && pagination.total > 0 && (
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-2 text-sm">
                      <Label htmlFor="report-per-page" className="font-normal text-muted-foreground">Rows per page</Label>
                      <Select value={String(per_page)} onValueChange={(v) => update({ per_page: Number(v) === DEFAULT_PER_PAGE ? null : v })}>
                        <SelectTrigger id="report-per-page" size="sm" className="w-20"><SelectValue /></SelectTrigger>
                        <SelectContent>{PER_PAGE_OPTIONS.map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div className="sm:min-w-80">
                      <PaginationBar pagination={pagination} onPageChange={(page) => update({ page: page === 1 ? null : String(page) })} />
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function RunError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const { title, message } = runErrorMessage(error)
  return <ErrorState title={title} error={new Error(message)} onRetry={onRetry} />
}

function RunNotes({ run, currency, hiddenCost, timeZone }: { run: ReportRun; currency: string | null; hiddenCost: ReportColumn[]; timeZone?: string }) {
  const parts = [currency ? `Amounts in ${currency}` : null, run.generated_at ? `Generated ${formatDateCell(run.generated_at, timeZone)}` : null].filter(Boolean)
  return (
    <div className="flex flex-col gap-2 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
      {parts.length > 0 && <p>{parts.join(' · ')}</p>}
      {hiddenCost.length > 0 && (
        <p className="flex items-center gap-1.5" data-testid="cost-hidden-note">
          <EyeOffIcon className="size-3.5" aria-hidden />
          {hiddenCost.map((c) => c.label).join(', ')} {hiddenCost.length === 1 ? 'is' : 'are'} hidden — showing cost and profit needs permission to view cost prices.
        </p>
      )}
    </div>
  )
}
