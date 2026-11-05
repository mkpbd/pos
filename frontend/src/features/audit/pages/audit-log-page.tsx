import { Fragment, useState } from 'react'
import { ChevronDownIcon, ChevronRightIcon } from 'lucide-react'
import { ExportMenu } from '@/components/common/export-menu'
import { PageHeader } from '@/components/common/page-header'
import { PaginationBar } from '@/components/common/pagination-bar'
import { EmptyState, ErrorState, LoadingState } from '@/components/common/state-views'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useAuditLogQuery, type AuditEntry } from '@/features/audit/api'

const ACTION_FILTERS = [
  { value: 'all', label: 'All actions' },
  { value: 'auth.*', label: 'Sign-ins & security' },
  { value: 'user.*', label: 'Users' },
  { value: 'role.*', label: 'Roles' },
  { value: 'branch.*', label: 'Branches' },
  { value: 'store.*', label: 'Stores' },
  { value: 'organization.*', label: 'Organization' },
]

function ValuesTable({ title, values }: { title: string; values: Record<string, unknown> | null }) {
  if (!values || Object.keys(values).length === 0) return null

  return (
    <div className="min-w-0 flex-1">
      <p className="mb-1 text-xs font-medium uppercase text-muted-foreground">{title}</p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        {Object.entries(values).map(([key, value]) => (
          <Fragment key={key}>
            <dt className="font-mono text-muted-foreground">{key}</dt>
            <dd className="font-mono break-all">{typeof value === 'string' ? value : JSON.stringify(value)}</dd>
          </Fragment>
        ))}
      </dl>
    </div>
  )
}

function EntryDetails({ entry }: { entry: AuditEntry }) {
  return (
    <div className="flex flex-col gap-3 bg-muted/40 p-3 sm:flex-row">
      <ValuesTable title="Before" values={entry.old_values} />
      <ValuesTable title="After" values={entry.new_values} />
      <ValuesTable title="Context" values={entry.context} />
      <div className="text-xs text-muted-foreground sm:w-56">
        <p>IP: {entry.ip_address ?? '—'}</p>
        <p className="break-all">Request: {entry.request_id ?? '—'}</p>
        {entry.subject_id && <p className="break-all">Subject: {entry.subject_type} {entry.subject_id}</p>}
      </div>
    </div>
  )
}

export function AuditLogPage() {
  const [page, setPage] = useState(1)
  const [action, setAction] = useState('all')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)

  const filters = {
    action: action === 'all' ? undefined : action,
    from: from || undefined,
    to: to || undefined,
  }
  const { data, error, isPending, refetch } = useAuditLogQuery({ page, ...filters })

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Audit log"
        description="Append-only record of sensitive changes in your organization."
        actions={<ExportMenu list="auditLog" query={filters} disabled={!data?.items.length} />}
      />

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="audit-action">Action</Label>
          <Select value={action} onValueChange={(v) => { setAction(v); setPage(1) }}>
            <SelectTrigger id="audit-action" className="w-52"><SelectValue /></SelectTrigger>
            <SelectContent>
              {ACTION_FILTERS.map((f) => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="audit-from">From</Label>
          <Input id="audit-from" type="date" value={from} max={to || undefined} onChange={(e) => { setFrom(e.target.value); setPage(1) }} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="audit-to">To</Label>
          <Input id="audit-to" type="date" value={to} min={from || undefined} onChange={(e) => { setTo(e.target.value); setPage(1) }} />
        </div>
      </div>

      {isPending ? (
        <LoadingState rows={6} label="Loading audit log" />
      ) : error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : data.items.length === 0 ? (
        <EmptyState title="No entries" description="Nothing matches these filters." />
      ) : (
        <>
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10"><span className="sr-only">Details</span></TableHead>
                  <TableHead>When</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead className="hidden md:table-cell">Subject</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((entry) => {
                  const open = expanded === entry.id
                  return (
                    <Fragment key={entry.id}>
                      <TableRow>
                        <TableCell>
                          <Button variant="ghost" size="icon-sm" aria-expanded={open} aria-label={open ? 'Hide details' : 'Show details'} onClick={() => setExpanded(open ? null : entry.id)}>
                            {open ? <ChevronDownIcon /> : <ChevronRightIcon />}
                          </Button>
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-sm">{new Date(entry.created_at).toLocaleString()}</TableCell>
                        <TableCell><Badge variant="outline" className="font-mono">{entry.action}</Badge></TableCell>
                        <TableCell className="hidden text-sm text-muted-foreground md:table-cell">{entry.subject_type ?? '—'}</TableCell>
                      </TableRow>
                      {open && (
                        <TableRow>
                          <TableCell colSpan={4} className="p-0"><EntryDetails entry={entry} /></TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  )
                })}
              </TableBody>
            </Table>
          </div>
          <PaginationBar pagination={data.pagination} onPageChange={setPage} />
        </>
      )}
    </div>
  )
}
