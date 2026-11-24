import { RotateCwIcon } from 'lucide-react'
import { PageHeader } from '@/components/common/page-header'
import { ErrorState, LoadingState } from '@/components/common/state-views'
import { Button } from '@/components/ui/button'
import { useSystemStatusQuery } from '@/features/system/api'
import { BackupsCard } from '@/features/system/components/backups-card'
import { FailedJobsCard } from '@/features/system/components/failed-jobs-card'
import { HealthCard } from '@/features/system/components/health-card'
import { WarningsList } from '@/features/system/components/warnings-list'
import { formatDateTime, useNow } from '@/features/system/format'

/**
 * G1b: the System status page for platform admins — install-wide operations (no tenant data, works
 * without an organization). Everything comes from /platform/system/*.
 */
export function OperationsView({ adminEmail }: { adminEmail: string }) {
  const status = useSystemStatusQuery()
  const now = useNow()

  return (
    <div className="mx-auto flex w-full max-w-5xl min-w-0 flex-col gap-6">
      <PageHeader
        title="System status"
        description={status.dataUpdatedAt ? `Operations overview · checked ${formatDateTime(new Date(status.dataUpdatedAt).toISOString())}` : 'Operations overview'}
        actions={
          <Button variant="outline" size="sm" onClick={() => status.refetch()} disabled={status.isFetching}>
            <RotateCwIcon data-icon="inline-start" className={status.isFetching ? 'animate-spin' : undefined} aria-hidden />
            Refresh
          </Button>
        }
      />

      {status.isPending ? (
        <LoadingState rows={4} label="Loading system status" />
      ) : status.error ? (
        <ErrorState title="Could not load the system status" error={status.error} onRetry={() => status.refetch()} />
      ) : (
        <>
          <WarningsList warnings={status.data.warnings} />
          <HealthCard report={status.data} now={now} adminEmail={adminEmail} />
          <BackupsCard check={status.data.checks.backups} now={now} />
          <FailedJobsCard now={now} />
        </>
      )}
    </div>
  )
}
