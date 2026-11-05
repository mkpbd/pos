import { useState } from 'react'
import { DownloadIcon, SearchIcon } from 'lucide-react'
import { ExportMenu } from '@/components/common/export-menu'
import { PaginationBar } from '@/components/common/pagination-bar'
import { EmptyState, ErrorState, LoadingState } from '@/components/common/state-views'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { NEWSLETTER_EXPORT_URL, useSubscribersQuery, type SubscriberStatus } from '@/features/content/api'
import { ContentHeader } from '@/features/content/components/content-header'
import { useDebouncedValue } from '@/lib/use-debounced-value'

const ALL = 'all'
const STATUS: Record<SubscriberStatus, { label: string; variant: 'success' | 'warning' | 'soft' }> = {
  subscribed: { label: 'Subscribed', variant: 'success' },
  pending: { label: 'Awaiting confirmation', variant: 'warning' },
  unsubscribed: { label: 'Unsubscribed', variant: 'soft' },
}

export function NewsletterPage() {
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<SubscriberStatus | typeof ALL>(ALL)
  const debounced = useDebouncedValue(search, 300)
  const filters = { search: debounced || undefined, status: status === ALL ? undefined : status }
  const subscribers = useSubscribersQuery({ page, ...filters })

  return (
    <div className="flex flex-col gap-6">
      <ContentHeader
        actions={
          <>
            <ExportMenu list="newsletterSubscribers" query={filters} disabled={!subscribers.data?.items.length} />
            <Button asChild variant="outline">
              <a href={NEWSLETTER_EXPORT_URL} download>
                <DownloadIcon data-icon="inline-start" /> Export subscribers (CSV)
              </a>
            </Button>
          </>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Newsletter sign-ups</CardTitle>
          <CardDescription>
            Visitors confirm their address through an e-mailed link before they count as subscribed. The export contains confirmed subscribers only, for your mailing tool.
            {subscribers.data && ` ${subscribers.data.counts.subscribed} subscribed, ${subscribers.data.counts.pending} awaiting confirmation.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-3">
            <div className="relative min-w-56 flex-1">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-8"
                placeholder="Search e-mail"
                aria-label="Search subscribers"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value)
                  setPage(1)
                }}
              />
            </div>
            <Select
              value={status}
              onValueChange={(v) => {
                setStatus(v as SubscriberStatus | typeof ALL)
                setPage(1)
              }}
            >
              <SelectTrigger aria-label="Status" className="w-52"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All</SelectItem>
                {(Object.keys(STATUS) as SubscriberStatus[]).map((s) => <SelectItem key={s} value={s}>{STATUS[s].label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {subscribers.isPending ? (
            <LoadingState label="Loading subscribers" />
          ) : subscribers.error ? (
            <ErrorState error={subscribers.error} onRetry={() => subscribers.refetch()} />
          ) : subscribers.data.items.length === 0 ? (
            <EmptyState title="No sign-ups yet" description="Add a newsletter section to your homepage to collect them." />
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>E-mail</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="hidden md:table-cell">Signed up</TableHead>
                    <TableHead className="hidden md:table-cell">Confirmed</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {subscribers.data.items.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell>{s.email}</TableCell>
                      <TableCell><Badge variant={STATUS[s.status].variant}>{STATUS[s.status].label}</Badge></TableCell>
                      <TableCell className="hidden text-sm whitespace-nowrap text-muted-foreground md:table-cell">{s.created_at ? new Date(s.created_at).toLocaleDateString() : '—'}</TableCell>
                      <TableCell className="hidden text-sm whitespace-nowrap text-muted-foreground md:table-cell">{s.confirmed_at ? new Date(s.confirmed_at).toLocaleDateString() : '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <PaginationBar pagination={subscribers.data.pagination} onPageChange={setPage} />
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
