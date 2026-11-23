import { useState } from 'react'
import { SearchIcon } from 'lucide-react'
import { PageHeader } from '@/components/common/page-header'
import { PaginationBar } from '@/components/common/pagination-bar'
import { EmptyState, ErrorState, LoadingState } from '@/components/common/state-views'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useLoginActivitiesQuery } from '@/features/audit/api'
import { deviceSummary } from '@/features/audit/device'
import { SectionTabs } from '@/features/inventory/components/inventory-tabs'
import { AUDIT_TABS } from '@/features/inventory/sections'
import { useDebouncedValue } from '@/lib/use-debounced-value'

type Result = 'all' | 'succeeded' | 'failed'

const RESULTS: { value: Result; label: string }[] = [
  { value: 'all', label: 'All sign-ins' },
  { value: 'succeeded', label: 'Successful' },
  { value: 'failed', label: 'Failed' },
]

function failureLabel(reason: string | null): string {
  if (!reason) return 'Failed'
  const text = reason.replaceAll('_', ' ')
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** /audit-log/sign-ins — every sign-in attempt in the organization (GET /login-activities, audit.view). */
export function SignInsPage() {
  const [page, setPage] = useState(1)
  const [result, setResult] = useState<Result>('all')
  const [search, setSearch] = useState('')
  const term = useDebouncedValue(search.trim(), 300)
  const { data, error, isPending, refetch } = useLoginActivitiesQuery({
    page,
    search: term || undefined,
    succeeded: result === 'all' ? undefined : result === 'succeeded',
  })

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Audit log" description="Who signed in, when and from where — including failed attempts." />
      <SectionTabs tabs={AUDIT_TABS} label="Audit log sections" />

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="sign-ins-result">Result</Label>
          <Select value={result} onValueChange={(v) => { setResult(v as Result); setPage(1) }}>
            <SelectTrigger id="sign-ins-result" className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              {RESULTS.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="sign-ins-search">E-mail or IP address</Label>
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input id="sign-ins-search" type="search" className="w-64 pl-8" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1) }} />
          </div>
        </div>
      </div>

      {isPending ? (
        <LoadingState rows={6} label="Loading sign-ins" />
      ) : error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : data.items.length === 0 ? (
        <EmptyState title="No sign-ins" description="Nothing matches these filters." />
      ) : (
        <>
          <div className="overflow-x-auto rounded-md border">
            <Table aria-label="Sign-ins">
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Who</TableHead>
                  <TableHead>Result</TableHead>
                  <TableHead className="hidden md:table-cell">Device</TableHead>
                  <TableHead className="hidden sm:table-cell">IP address</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="whitespace-nowrap text-sm">{new Date(a.created_at).toLocaleString()}</TableCell>
                    <TableCell className="text-sm break-all">{a.email ?? '—'}</TableCell>
                    <TableCell>
                      {a.succeeded ? <Badge variant="success">Signed in</Badge> : <Badge variant="destructive">{failureLabel(a.failure_reason)}</Badge>}
                    </TableCell>
                    <TableCell className="hidden text-sm md:table-cell" title={a.user_agent ?? undefined}>
                      {deviceSummary(a.user_agent)}
                      <span className="text-muted-foreground"> · {a.channel === 'session' ? 'web' : 'device token'}</span>
                    </TableCell>
                    <TableCell className="hidden font-mono text-xs sm:table-cell">{a.ip_address ?? '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <PaginationBar pagination={data.pagination} onPageChange={setPage} />
        </>
      )}
    </div>
  )
}
