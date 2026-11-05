import { useState } from 'react'
import { MailIcon, SearchIcon } from 'lucide-react'
import { toast } from 'sonner'
import { ExportMenu } from '@/components/common/export-menu'
import { PaginationBar } from '@/components/common/pagination-bar'
import { EmptyState, ErrorState, LoadingState } from '@/components/common/state-views'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useContactMessagesQuery, useMarkMessageMutation, type ContactMessage } from '@/features/content/api'
import { ContentHeader } from '@/features/content/components/content-header'
import { useDebouncedValue } from '@/lib/use-debounced-value'

type Filter = 'open' | 'handled' | 'all'

function MessageCard({ message }: { message: ContactMessage }) {
  const mark = useMarkMessageMutation()

  return (
    <li className="flex flex-col gap-2 rounded-md border p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium">{message.subject ?? 'No subject'}</p>
          <p className="text-sm text-muted-foreground">
            {message.name} · <a className="underline" href={`mailto:${message.email}`}>{message.email}</a>
            {message.phone && <> · {message.phone}</>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm whitespace-nowrap text-muted-foreground">{message.created_at ? new Date(message.created_at).toLocaleString() : ''}</span>
          {message.is_handled ? <Badge variant="success">Handled</Badge> : <Badge variant="warning">Open</Badge>}
        </div>
      </div>
      <p className="text-sm whitespace-pre-line">{message.message}</p>
      <div className="flex gap-2">
        <Button asChild variant="outline" size="sm">
          <a href={`mailto:${message.email}?subject=${encodeURIComponent(`Re: ${message.subject ?? 'Your message'}`)}`}>
            <MailIcon data-icon="inline-start" /> Reply by e-mail
          </a>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={mark.isPending}
          onClick={() =>
            mark.mutate(
              { id: message.id, handled: !message.is_handled },
              { onSuccess: () => toast.success(message.is_handled ? 'Marked as open.' : 'Marked as handled.'), onError: (e) => toast.error(e.message) },
            )
          }
        >
          {message.is_handled ? 'Mark as open' : 'Mark as handled'}
        </Button>
      </div>
    </li>
  )
}

export function MessagesPage() {
  const [filter, setFilter] = useState<Filter>('open')
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const debounced = useDebouncedValue(search, 300)
  const filters = { search: debounced || undefined, status: filter === 'all' ? undefined : filter }
  const messages = useContactMessagesQuery({ page, ...filters })

  return (
    <div className="flex flex-col gap-6">
      <ContentHeader actions={<ExportMenu list="contactMessages" query={filters} disabled={!messages.data?.items.length} />} />
      <Card>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <Tabs
              value={filter}
              onValueChange={(v) => {
                setFilter(v as Filter)
                setPage(1)
              }}
            >
              <TabsList aria-label="Message status">
                <TabsTrigger value="open">Open{messages.data ? ` (${messages.data.open})` : ''}</TabsTrigger>
                <TabsTrigger value="handled">Handled</TabsTrigger>
                <TabsTrigger value="all">All</TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="relative min-w-56 flex-1">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-8"
                placeholder="Search name, e-mail or subject"
                aria-label="Search messages"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value)
                  setPage(1)
                }}
              />
            </div>
          </div>

          {messages.isPending ? (
            <LoadingState label="Loading messages" />
          ) : messages.error ? (
            <ErrorState error={messages.error} onRetry={() => messages.refetch()} />
          ) : messages.data.items.length === 0 ? (
            <EmptyState title={filter === 'open' ? 'No open messages' : 'No messages'} description="Messages sent with the contact form of your store appear here." />
          ) : (
            <>
              <ul className="flex flex-col gap-3" aria-label="Contact messages">
                {messages.data.items.map((m) => <MessageCard key={m.id} message={m} />)}
              </ul>
              <PaginationBar pagination={messages.data.pagination} onPageChange={setPage} />
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
