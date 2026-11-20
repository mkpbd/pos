import { useId, useState } from 'react'
import { ArrowRightLeftIcon, BotIcon, SearchIcon, UserIcon, WrenchIcon } from 'lucide-react'
import { PaginationBar } from '@/components/common/pagination-bar'
import { EmptyState, ErrorState, LoadingState } from '@/components/common/state-views'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useDebouncedValue } from '@/lib/use-debounced-value'
import { useAssistantConversationQuery, useAssistantConversationsQuery, type ConversationFilters, type SummaryRange } from './api'
import { LANGUAGE_WORDS, makeDateTime, plural, REPLY_STATUS_WORDS, toolLabel, type ConversationRow, type TranscriptMessage } from './model'

type HandedOff = ConversationFilters['handedOff']

const shopperWords = (c: Pick<ConversationRow, 'signed_in' | 'customer_name'>) => c.customer_name ?? (c.signed_in ? 'Signed-in shopper' : 'Guest')

/** AI2b conversations list: search, hand-off filter (dates come from the page), transcript drawer. */
export function AssistantConversations({ range, timeZone }: { range: SummaryRange; timeZone: string | undefined }) {
  const id = useId()
  const [search, setSearch] = useState('')
  const [handedOff, setHandedOff] = useState<HandedOff>('all')
  const [page, setPage] = useState(1)
  const [rangeSeen, setRangeSeen] = useState(range)
  const [open, setOpen] = useState<ConversationRow | null>(null)
  const term = useDebouncedValue(search.trim())
  // New dates start again at page 1.
  if (rangeSeen.from !== range.from || rangeSeen.to !== range.to) {
    setRangeSeen(range)
    setPage(1)
  }
  const filters: ConversationFilters = { ...range, search: term, handedOff, page }
  const conversations = useAssistantConversationsQuery(filters)
  const when = makeDateTime(timeZone)
  const rows = conversations.data?.items ?? []
  const filtered = term !== '' || handedOff !== 'all'

  return (
    <section aria-labelledby={`${id}-title`} className="flex flex-col gap-4">
      <h2 id={`${id}-title`} className="text-base font-semibold">Chats</h2>
      <div className="flex flex-wrap items-end gap-3">
        <div className="relative w-full max-w-xs">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            type="search"
            aria-label="Search chats"
            placeholder="Search what was said"
            className="pl-8"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              setPage(1)
            }}
          />
        </div>
        <Select
          value={handedOff}
          onValueChange={(v) => {
            setHandedOff(v as HandedOff)
            setPage(1)
          }}
        >
          <SelectTrigger aria-label="Filter by hand-off" className="w-52"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All chats</SelectItem>
            <SelectItem value="yes">Handed off</SelectItem>
            <SelectItem value="no">Not handed off</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {conversations.isPending ? (
        <LoadingState rows={4} label="Loading chats" />
      ) : conversations.isError ? (
        <ErrorState error={conversations.error} onRetry={() => conversations.refetch()} title="Could not load the chats" />
      ) : rows.length === 0 ? (
        <EmptyState
          title={filtered ? 'No chats match' : 'No chats in these days'}
          description={filtered ? 'Try other words or show all chats.' : 'Chats appear here once shoppers use the assistant on your store.'}
        />
      ) : (
        <>
          <div className="overflow-x-auto rounded-md border">
            <Table aria-label="Assistant chats">
              <TableHeader>
                <TableRow>
                  <TableHead>Started</TableHead>
                  <TableHead>First message</TableHead>
                  <TableHead className="hidden md:table-cell">Shopper</TableHead>
                  <TableHead className="hidden sm:table-cell">Language</TableHead>
                  <TableHead className="hidden sm:table-cell text-right">Messages</TableHead>
                  <TableHead>Handed off</TableHead>
                  <TableHead className="text-right"><span className="sr-only">Actions</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((c) => (
                  <TableRow key={c.id} data-testid={`chat-${c.id}`}>
                    <TableCell className="whitespace-nowrap">{when(c.started_at)}</TableCell>
                    <TableCell className="max-w-72">
                      <span className="line-clamp-2" lang={c.language}>{c.preview || <span className="text-muted-foreground" lang="en">No message</span>}</span>
                      <span className="block text-xs text-muted-foreground md:hidden">{shopperWords(c)}<span className="sm:hidden"> · {LANGUAGE_WORDS[c.language]} · {plural(c.message_count, 'message')}</span></span>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">{shopperWords(c)}</TableCell>
                    <TableCell className="hidden sm:table-cell">{LANGUAGE_WORDS[c.language]}</TableCell>
                    <TableCell className="hidden sm:table-cell text-right tabular-nums">{c.message_count}</TableCell>
                    <TableCell>{c.handed_off ? <Badge variant="info"><ArrowRightLeftIcon aria-hidden data-icon="inline-start" />Yes</Badge> : <span className="text-muted-foreground">No</span>}</TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="outline" aria-label={`Read the chat started ${when(c.started_at)}`} onClick={() => setOpen(c)}>Read</Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <PaginationBar pagination={conversations.data.pagination} onPageChange={setPage} />
        </>
      )}

      {open && <TranscriptSheet key={open.id} row={open} timeZone={timeZone} onClose={() => setOpen(null)} />}
    </section>
  )
}

/** One chat as it happened: each message with its time; each reply with the lookups it used. */
export function TranscriptSheet({ row, timeZone, onClose }: { row: ConversationRow; timeZone: string | undefined; onClose: () => void }) {
  const transcript = useAssistantConversationQuery(row.id)
  const when = makeDateTime(timeZone)
  const chat = transcript.data ?? row
  const messages = transcript.data?.messages ?? []

  return (
    <Sheet open onOpenChange={(o) => { if (!o) onClose() }}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>Chat from {when(chat.started_at)}</SheetTitle>
          <SheetDescription>
            {shopperWords(chat)} · {LANGUAGE_WORDS[chat.language]} · {plural(chat.message_count, 'message')}
            {chat.handed_off ? ' · Handed off' : ''}
          </SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-3 px-4 pb-6">
          {transcript.isPending ? (
            <LoadingState rows={4} label="Loading the chat" />
          ) : transcript.isError ? (
            <ErrorState error={transcript.error} onRetry={() => transcript.refetch()} title="Could not load the chat" />
          ) : messages.length === 0 ? (
            <EmptyState title="No messages" description="This chat has no messages left." />
          ) : (
            <ol aria-label="Messages" className="flex flex-col gap-3">
              {messages.map((m) => <MessageItem key={m.id} message={m} language={chat.language} when={when} />)}
            </ol>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}

function MessageItem({ message, language, when }: { message: TranscriptMessage; language: string; when: (iso: string | null) => string }) {
  const fromShopper = message.role === 'user'
  const Icon = fromShopper ? UserIcon : BotIcon
  const status = message.status !== 'ok' ? REPLY_STATUS_WORDS[message.status] : null
  return (
    <li className={fromShopper ? 'flex flex-col gap-1 rounded-lg border bg-muted/40 p-3' : 'flex flex-col gap-1 rounded-lg border p-3'} data-testid={`message-${message.id}`}>
      <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
        <Icon className="size-3.5" aria-hidden />
        <span className="font-medium text-foreground">{fromShopper ? 'Shopper' : 'Assistant'}</span>
        <time dateTime={message.created_at ?? undefined}>{when(message.created_at)}</time>
      </div>
      <p className="text-sm break-words whitespace-pre-line" lang={language}>{message.text}</p>
      {status && (
        <p className="text-xs text-muted-foreground">
          <Badge variant="warning">{status.label}</Badge> {status.hint}
        </p>
      )}
      {!fromShopper && message.tools.length > 0 && (
        <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
          <WrenchIcon className="size-3.5" aria-hidden />
          <span>Looked up:</span>
          <ul className="flex flex-wrap gap-1" aria-label="Lookups used for this reply">
            {[...new Set(message.tools)].map((t) => <li key={t}><Badge variant="outline">{toolLabel(t)}</Badge></li>)}
          </ul>
        </div>
      )}
    </li>
  )
}
