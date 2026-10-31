import { CheckCircle2Icon, RotateCwIcon, XCircleIcon } from 'lucide-react'
import { ErrorState, LoadingState } from '@/components/common/state-views'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useHealthQuery } from '@/features/system/api'

const CHECK_LABELS: Record<string, string> = {
  database: 'Database (PostgreSQL)',
  cache: 'Cache',
}

export function SystemStatusPage() {
  const { data, error, isPending, isFetching, refetch, dataUpdatedAt } = useHealthQuery()

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">System status</h1>
        <p className="text-sm text-muted-foreground">Live connectivity of the POS backend and its dependencies.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Backend
            {data && (
              <Badge variant={data.status === 'ok' ? 'secondary' : 'destructive'}>
                {data.status === 'ok' ? 'Operational' : 'Degraded'}
              </Badge>
            )}
          </CardTitle>
          <CardDescription>
            {dataUpdatedAt ? `Last checked ${new Date(dataUpdatedAt).toLocaleTimeString()}` : 'Checking…'}
          </CardDescription>
          <CardAction>
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
              <RotateCwIcon data-icon="inline-start" className={isFetching ? 'animate-spin' : undefined} />
              Refresh
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          {isPending ? (
            <LoadingState rows={2} label="Checking system health" />
          ) : error ? (
            <ErrorState title="Backend unreachable" error={error} onRetry={() => refetch()} />
          ) : (
            <ul className="divide-y rounded-md border">
              {Object.entries(data.checks).map(([name, status]) => (
                <li key={name} className="flex items-center justify-between px-4 py-3 text-sm">
                  <span>{CHECK_LABELS[name] ?? name}</span>
                  {status === 'ok' ? (
                    <span className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
                      <CheckCircle2Icon className="size-4" aria-hidden /> OK
                    </span>
                  ) : (
                    <span className="flex items-center gap-1.5 text-destructive">
                      <XCircleIcon className="size-4" aria-hidden /> Failing
                    </span>
                  )}
                </li>
              ))}
              <li className="flex items-center justify-between px-4 py-3 text-sm text-muted-foreground">
                <span>Environment</span>
                <span className="font-mono">{data.environment}</span>
              </li>
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
