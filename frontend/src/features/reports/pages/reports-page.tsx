import { Link } from 'react-router'
import { BoxesIcon, ChevronRightIcon, ContactIcon, LandmarkIcon, ReceiptTextIcon, ShoppingCartIcon, type LucideIcon } from 'lucide-react'
import { PageHeader } from '@/components/common/page-header'
import { EmptyState, ErrorState, LoadingState } from '@/components/common/state-views'
import { useCan } from '@/features/auth/use-auth'
import { GROUP_LABELS, REPORT_GROUPS, useReportRegistryQuery, type ReportGroup } from '@/features/reports/api'

const GROUP_ICONS: Record<ReportGroup, LucideIcon> = {
  sales: ReceiptTextIcon,
  inventory: BoxesIcon,
  purchasing: ShoppingCartIcon,
  finance: LandmarkIcon,
  customers: ContactIcon,
}

/** /reports — the reports this user may run (from the server's registry), grouped. */
export function ReportsPage() {
  const can = useCan()
  const { data, error, isPending, refetch } = useReportRegistryQuery()

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Reports" description="Sales, stock, purchasing and finance reports for your branches — filter, sort and export to Excel, CSV or PDF." />
      {isPending ? (
        <LoadingState rows={4} label="Loading reports" />
      ) : error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : (
        (() => {
          // The server lists only what the user may run; the check here only guards a stale cache.
          const runnable = data.filter((d) => !d.permission || can(d.permission))
          if (runnable.length === 0) return <EmptyState title="No reports available" description="Your role does not include any reports. Ask an administrator for access." />
          return REPORT_GROUPS.map((group) => {
            const reports = runnable.filter((d) => d.group === group)
            if (reports.length === 0) return null
            const Icon = GROUP_ICONS[group]
            return (
              <section key={group} aria-labelledby={`reports-${group}`} className="flex flex-col gap-3">
                <div className="flex items-center gap-2">
                  <span className="flex size-8 items-center justify-center rounded-full bg-primary/12 text-primary-soft-foreground"><Icon className="size-4" aria-hidden /></span>
                  <div>
                    <h2 id={`reports-${group}`} className="text-sm font-bold tracking-[0.1rem] text-heading uppercase">{GROUP_LABELS[group].title}</h2>
                    <p className="text-xs text-muted-foreground">{GROUP_LABELS[group].description}</p>
                  </div>
                </div>
                <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {reports.map((report) => (
                    <li key={report.key}>
                      <Link
                        to={`/reports/${report.key}`}
                        className="group flex h-full items-start justify-between gap-3 rounded-sm bg-card p-4 shadow-card outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <span className="flex min-w-0 flex-col gap-1">
                          <span className="font-medium text-heading">{report.title}</span>
                          {report.description && <span className="text-sm text-muted-foreground">{report.description}</span>}
                        </span>
                        <ChevronRightIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            )
          })
        })()
      )}
    </div>
  )
}
