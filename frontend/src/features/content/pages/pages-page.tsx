import { useState } from 'react'
import { Link } from 'react-router'
import { PlusIcon, SearchIcon } from 'lucide-react'
import { PaginationBar } from '@/components/common/pagination-bar'
import { EmptyState, ErrorState, LoadingState } from '@/components/common/state-views'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { PAGE_TEMPLATE_LABELS, usePagesQuery, type PageStatus } from '@/features/content/api'
import { ContentHeader } from '@/features/content/components/content-header'
import { PageStatusBadge } from '@/features/content/components/page-status-badge'
import { useDebouncedValue } from '@/lib/use-debounced-value'

const ALL = 'all'

export function PagesPage() {
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<PageStatus | typeof ALL>(ALL)
  const debounced = useDebouncedValue(search, 300)
  const pages = usePagesQuery({ page, search: debounced || undefined, status: status === ALL ? undefined : status })

  return (
    <div className="flex flex-col gap-6">
      <ContentHeader
        actions={
          <Button asChild>
            <Link to="/content/pages/new"><PlusIcon data-icon="inline-start" /> New page</Link>
          </Button>
        }
      />

      <Card>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-3">
            <div className="relative min-w-56 flex-1">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-8"
                placeholder="Search by title or address"
                aria-label="Search pages"
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
                setStatus(v as PageStatus | typeof ALL)
                setPage(1)
              }}
            >
              <SelectTrigger aria-label="Status" className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All pages</SelectItem>
                <SelectItem value="published">Published</SelectItem>
                <SelectItem value="draft">Drafts</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {pages.isPending ? (
            <LoadingState label="Loading pages" />
          ) : pages.error ? (
            <ErrorState error={pages.error} onRetry={() => pages.refetch()} />
          ) : pages.data.items.length === 0 ? (
            <EmptyState
              title={debounced || status !== ALL ? 'No matching pages' : 'No pages yet'}
              description="Pages hold texts like About us, delivery information or your privacy policy. Menus can link to them."
            />
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Title</TableHead>
                    <TableHead>Address</TableHead>
                    <TableHead className="hidden md:table-cell">Layout</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="hidden md:table-cell">Updated</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pages.data.items.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="font-medium">
                        <Link to={`/content/pages/${p.id}`} className="hover:underline">{p.title}</Link>
                      </TableCell>
                      <TableCell className="font-mono text-sm">/pages/{p.slug}</TableCell>
                      <TableCell className="hidden text-sm text-muted-foreground md:table-cell">{PAGE_TEMPLATE_LABELS[p.template].split(' (')[0]}</TableCell>
                      <TableCell><PageStatusBadge page={p} /></TableCell>
                      <TableCell className="hidden text-sm whitespace-nowrap text-muted-foreground md:table-cell">{p.updated_at ? new Date(p.updated_at).toLocaleString() : '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <PaginationBar pagination={pages.data.pagination} onPageChange={setPage} />
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
