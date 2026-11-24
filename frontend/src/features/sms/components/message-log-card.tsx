import { useState } from 'react'
import { SearchIcon } from 'lucide-react'
import { PaginationBar } from '@/components/common/pagination-bar'
import { EmptyState, ErrorState, LoadingState } from '@/components/common/state-views'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { PURPOSE_LABELS, STATUS_LABELS, useSmsMessagesQuery, type SmsPurpose, type SmsStatus } from '@/features/sms/api'
import { useDebouncedValue } from '@/lib/use-debounced-value'

const ALL = 'all'
const STATUS_VARIANT: Record<SmsStatus, 'success' | 'destructive' | 'warning' | 'secondary'> = { sent: 'success', failed: 'destructive', skipped: 'warning', queued: 'secondary' }

const ERROR_LABELS: Record<string, string> = {
  monthly_limit: 'Monthly limit reached',
  blocked_host: 'Gateway address not allowed',
}

/** SMS → Message log (sms.view): what was sent, to whom and why, newest first. */
export function MessageLogCard() {
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState<SmsStatus | typeof ALL>(ALL)
  const [purpose, setPurpose] = useState<SmsPurpose | typeof ALL>(ALL)
  const [search, setSearch] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const phone = useDebouncedValue(search.replace(/\D/g, ''), 300)
  const { data, error, isPending, refetch } = useSmsMessagesQuery({
    page,
    status: status === ALL ? undefined : status,
    purpose: purpose === ALL ? undefined : purpose,
    search: phone || undefined,
    from: from || undefined,
    to: to || undefined,
  })
  const filtered = status !== ALL || purpose !== ALL || phone !== '' || from !== '' || to !== ''

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Message log</h2>
        </CardTitle>
        <CardDescription>Every SMS the shop sent or tried to send. Sign-in codes are hidden.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="sms-log-status">Status</Label>
            <Select value={status} onValueChange={(v) => { setStatus(v as SmsStatus | typeof ALL); setPage(1) }}>
              <SelectTrigger id="sms-log-status" className="w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All statuses</SelectItem>
                {(Object.keys(STATUS_LABELS) as SmsStatus[]).map((s) => <SelectItem key={s} value={s}>{STATUS_LABELS[s]}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="sms-log-purpose">Type</Label>
            <Select value={purpose} onValueChange={(v) => { setPurpose(v as SmsPurpose | typeof ALL); setPage(1) }}>
              <SelectTrigger id="sms-log-purpose" className="w-52"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All messages</SelectItem>
                {(Object.keys(PURPOSE_LABELS) as SmsPurpose[]).map((p) => <SelectItem key={p} value={p}>{PURPOSE_LABELS[p]}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="sms-log-search">Mobile number</Label>
            <div className="relative">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input id="sms-log-search" type="search" inputMode="tel" className="w-44 pl-8" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1) }} />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="sms-log-from">From</Label>
            <Input id="sms-log-from" type="date" className="w-40" value={from} max={to || undefined} onChange={(e) => { setFrom(e.target.value); setPage(1) }} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="sms-log-to">To</Label>
            <Input id="sms-log-to" type="date" className="w-40" value={to} min={from || undefined} onChange={(e) => { setTo(e.target.value); setPage(1) }} />
          </div>
        </div>

        {isPending ? (
          <LoadingState rows={4} label="Loading messages" />
        ) : error ? (
          <ErrorState error={error} onRetry={() => refetch()} />
        ) : data.items.length === 0 ? (
          <EmptyState title="No messages" description={filtered ? 'Nothing matches these filters.' : 'Messages appear here once the shop sends its first SMS.'} />
        ) : (
          <>
            <div className="overflow-x-auto rounded-md border">
              <Table aria-label="SMS messages">
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>To</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="hidden md:table-cell">Message</TableHead>
                    <TableHead className="text-right">Parts</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.items.map((m) => (
                    <TableRow key={m.id}>
                      <TableCell className="text-sm whitespace-nowrap">{new Date(m.created_at).toLocaleString()}</TableCell>
                      <TableCell className="font-mono text-sm whitespace-nowrap">{m.to_phone}</TableCell>
                      <TableCell className="text-sm">
                        {PURPOSE_LABELS[m.purpose] ?? m.purpose}
                        {m.driver === 'log' && <span className="block text-xs text-muted-foreground">Test mode</span>}
                      </TableCell>
                      <TableCell className="hidden max-w-sm md:table-cell">
                        <p className="line-clamp-2 text-sm break-words" title={m.body}>{m.body}</p>
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm" title={m.encoding === 'unicode' ? 'Unicode' : 'GSM'}>{m.segments}</TableCell>
                      <TableCell>
                        <Badge variant={STATUS_VARIANT[m.status] ?? 'secondary'}>{STATUS_LABELS[m.status] ?? m.status}</Badge>
                        {m.error && <span className="mt-1 block max-w-48 text-xs break-words text-destructive">{ERROR_LABELS[m.error] ?? m.error}</span>}
                        {m.attempts > 1 && <span className="block text-xs text-muted-foreground">{m.attempts} tries</span>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <PaginationBar pagination={data.pagination} onPageChange={setPage} />
          </>
        )}
      </CardContent>
    </Card>
  )
}
