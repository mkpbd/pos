import { useState } from 'react'
import { Link } from 'react-router'
import { ArrowLeftIcon, SearchIcon } from 'lucide-react'
import { PageHeader } from '@/components/common/page-header'
import { PaginationBar } from '@/components/common/pagination-bar'
import { EmptyState, ErrorState, LoadingState } from '@/components/common/state-views'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useErrorEventsQuery, type ErrorSort, type ErrorStatus } from '@/features/system/api'
import { formatCount, formatDateTime, formatRelative, useNow } from '@/features/system/format'
import { shortClass } from '@/features/system/labels'
import { useDebouncedValue } from '@/lib/use-debounced-value'

const STATUS_TABS: { value: ErrorStatus; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'ignored', label: 'Ignored' },
]

const SORTS: { value: ErrorSort; label: string }[] = [
  { value: '-last_seen_at', label: 'Last seen' },
  { value: '-occurrences', label: 'Most frequent' },
]

const EMPTY: Record<ErrorStatus, string> = {
  open: 'No open errors. New unexpected errors appear here.',
  resolved: 'Nothing marked as resolved.',
  ignored: 'Nothing ignored.',
}

/** /system-status/errors — the built-in error log (platform admins). */
export function SystemErrorsPage() {
  const now = useNow()
  const [status, setStatus] = useState<ErrorStatus>('open')
  const [sort, setSort] = useState<ErrorSort>('-last_seen_at')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const term = useDebouncedValue(search.trim(), 300)
  const errors = useErrorEventsQuery({ status, sort, search: term || undefined, page })

  return (
    <div className="mx-auto flex w-full max-w-5xl min-w-0 flex-col gap-6">
      <Button asChild variant="ghost" size="sm" className="self-start">
        <Link to="/system-status">
          <ArrowLeftIcon data-icon="inline-start" aria-hidden />
          System status
        </Link>
      </Button>
      <PageHeader title="Application errors" description="Unexpected server errors, grouped by where they happen. Resolve them once fixed; a resolved error that comes back opens again." />

      <div className="flex flex-wrap items-end gap-3">
        <Tabs
          value={status}
          onValueChange={(v) => {
            setStatus(v as ErrorStatus)
            setPage(1)
          }}
        >
          <TabsList aria-label="Error status">
            {STATUS_TABS.map((t) => (
              <TabsTrigger key={t.value} value={t.value}>
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="flex min-w-0 flex-1 flex-col gap-1.5 sm:max-w-80">
          <Label htmlFor="errors-search">Search</Label>
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              id="errors-search"
              type="search"
              className="pl-8"
              placeholder="Class or message"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value)
                setPage(1)
              }}
            />
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="errors-sort">Sort by</Label>
          <Select
            value={sort}
            onValueChange={(v) => {
              setSort(v as ErrorSort)
              setPage(1)
            }}
          >
            <SelectTrigger id="errors-sort" className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SORTS.map((s) => (
                <SelectItem key={s.value} value={s.value}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {errors.isPending ? (
        <LoadingState rows={5} label="Loading errors" />
      ) : errors.error ? (
        <ErrorState error={errors.error} onRetry={() => errors.refetch()} />
      ) : errors.data.items.length === 0 ? (
        <EmptyState title="No errors" description={term ? 'Nothing matches this search.' : EMPTY[status]} />
      ) : (
        <>
          <div className="rounded-md border">
            <Table aria-label={`${STATUS_TABS.find((t) => t.value === status)?.label} errors`}>
              <TableHeader>
                <TableRow>
                  <TableHead>Error</TableHead>
                  <TableHead className="text-right">Count</TableHead>
                  <TableHead>Last seen</TableHead>
                  <TableHead className="hidden md:table-cell">First seen</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {errors.data.items.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="max-w-[28rem] min-w-56 whitespace-normal">
                      <Link to={`/system-status/errors/${e.id}`} className="font-medium text-primary underline-offset-4 hover:underline" title={e.exception_class}>
                        {shortClass(e.exception_class)}
                      </Link>
                      <span className="block text-sm break-words">{e.message}</span>
                      {(e.last_path || e.file) && (
                        <span className="block font-mono text-xs break-all text-muted-foreground">
                          {e.last_path ? `${e.last_method ?? ''} ${e.last_path}`.trim() : `${e.file}${e.line ? `:${e.line}` : ''}`}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatCount(e.occurrences)}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      <time dateTime={e.last_seen_at} title={formatDateTime(e.last_seen_at)}>
                        {formatRelative(e.last_seen_at, now)}
                      </time>
                    </TableCell>
                    <TableCell className="hidden whitespace-nowrap md:table-cell">
                      <time dateTime={e.first_seen_at} title={formatDateTime(e.first_seen_at)}>
                        {formatRelative(e.first_seen_at, now)}
                      </time>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <PaginationBar pagination={errors.data.pagination} onPageChange={setPage} />
        </>
      )}
    </div>
  )
}
