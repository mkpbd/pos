import { useState, type FormEvent } from 'react'
import { BanIcon, EyeIcon, Loader2Icon, PlusIcon, SearchIcon } from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/common/page-header'
import { PaginationBar } from '@/components/common/pagination-bar'
import { EmptyState, ErrorState, LoadingState } from '@/components/common/state-views'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useAuth, useCan } from '@/features/auth/use-auth'
import {
  GIFT_CARD_ENTRY_LABELS,
  GIFT_CARD_KINDS,
  maskedCode,
  personName,
  useGiftCardQuery,
  useGiftCardsQuery,
  useVoidGiftCardMutation,
  type GiftCard,
  type GiftCardKind,
  type GiftCardStatus,
  type IssuedGiftCard,
} from '@/features/gift-cards/api'
import { GiftCodeDialog, type IssuedCode } from '@/features/gift-cards/components/gift-code-dialog'
import { IssueVoucherDialog } from '@/features/gift-cards/components/issue-voucher-dialog'
import { fieldErrorMap } from '@/lib/forms'
import { formatMoney, isZeroDecimal } from '@/lib/money'
import { useDebouncedValue } from '@/lib/use-debounced-value'

const ALL = 'all'

function useFormatters() {
  const timeZone = useAuth().organization?.timezone
  return {
    day: (iso: string) => new Date(iso).toLocaleDateString(undefined, { timeZone, dateStyle: 'medium' }),
    when: (iso: string) => new Date(iso).toLocaleString(undefined, { timeZone, dateStyle: 'medium', timeStyle: 'short' }),
  }
}

function StatusBadge({ card }: { card: Pick<GiftCard, 'status' | 'expired' | 'balance'> }) {
  if (card.status === 'void') return <Badge variant="destructive">Void</Badge>
  if (card.expired) return <Badge variant="warning">Expired</Badge>
  if (isZeroDecimal(card.balance)) return <Badge variant="outline">Used up</Badge>
  return <Badge variant="success">Active</Badge>
}

function VoidDialog({ card, onOpenChange }: { card: GiftCard | null; onOpenChange: (open: boolean) => void }) {
  const voiding = useVoidGiftCardMutation()
  const [reason, setReason] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const close = (open: boolean) => {
    if (voiding.isPending) return
    if (!open) { setReason(''); setConfirmed(false); setError(null) }
    onOpenChange(open)
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (!card) return
    if (!reason.trim()) return setError('Say why it is voided.')
    if (!confirmed) return setConfirmed(true)
    voiding.mutate({ id: card.id, reason: reason.trim() }, {
      onSuccess: () => { toast.success(`${GIFT_CARD_KINDS[card.kind]} ${maskedCode(card.code_last4)} voided.`); setReason(''); setConfirmed(false); setError(null); onOpenChange(false) },
      onError: (err) => { setConfirmed(false); const map = fieldErrorMap(err); setError(map.reason ?? map.form ?? err.message) },
    })
  }

  return (
    <Dialog open={card !== null} onOpenChange={close}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Void {card ? `${GIFT_CARD_KINDS[card.kind].toLowerCase()} ${maskedCode(card.code_last4)}` : ''}?</DialogTitle>
          <DialogDescription>
            {card && <>The remaining balance of <span className="font-mono">{formatMoney(card.balance, card.currency)}</span> is written off and the code can no longer be spent. This cannot be undone.</>}
          </DialogDescription>
        </DialogHeader>
        <form id="void-gift-card-form" onSubmit={onSubmit} noValidate className="flex flex-col gap-1.5">
          <Label htmlFor="void-reason">Reason</Label>
          <Input id="void-reason" autoFocus maxLength={200} value={reason} aria-invalid={error ? true : undefined} onChange={(e) => { setReason(e.target.value); setConfirmed(false); setError(null) }} placeholder="e.g. reported lost" />
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          {confirmed && !error && <p role="status" className="text-sm font-medium text-destructive">Press “Void now” to confirm.</p>}
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => close(false)} disabled={voiding.isPending}>Keep it</Button>
          <Button type="submit" form="void-gift-card-form" variant="destructive" disabled={voiding.isPending || !reason.trim()}>
            {voiding.isPending && <Loader2Icon data-icon="inline-start" className="animate-spin" />}
            {confirmed ? 'Void now' : 'Void'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function GiftCardSheet({ id, onOpenChange, onVoid }: { id: string | null; onOpenChange: (open: boolean) => void; onVoid: (card: GiftCard) => void }) {
  const can = useCan()
  const { day, when } = useFormatters()
  const { data, error, isPending, refetch } = useGiftCardQuery(id)

  return (
    <Sheet open={id !== null} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{data ? `${GIFT_CARD_KINDS[data.kind]} ${maskedCode(data.code_last4)}` : 'Gift card'}</SheetTitle>
          <SheetDescription>Only the last 4 characters of the code are kept; the full code was shown once when it was issued.</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-4 px-4 pb-4">
          {isPending ? (
            <LoadingState rows={4} label="Loading gift card" />
          ) : error ? (
            <ErrorState error={error} onRetry={() => refetch()} />
          ) : (
            <>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-md border p-3 text-sm">
                <div><dt className="text-xs text-muted-foreground">Balance</dt><dd className="font-mono text-lg font-semibold" data-testid="gift-card-balance">{formatMoney(data.balance, data.currency)}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Status</dt><dd><StatusBadge card={data} /></dd></div>
                <div><dt className="text-xs text-muted-foreground">Initial value</dt><dd className="font-mono">{formatMoney(data.initial_value, data.currency)}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Valid until</dt><dd>{data.expires_at ? day(data.expires_at) : 'No expiry'}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Customer</dt><dd>{data.customer?.name ?? '—'}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Issued</dt><dd>{when(data.issued_at)}{personName(data.issued_by) && ` by ${personName(data.issued_by)}`}</dd></div>
                {data.sale_receipt_number && <div><dt className="text-xs text-muted-foreground">Sold on</dt><dd className="font-mono">{data.sale_receipt_number}</dd></div>}
                {data.note && <div className="col-span-2"><dt className="text-xs text-muted-foreground">Note</dt><dd>{data.note}</dd></div>}
                {data.status === 'void' && (
                  <div className="col-span-2">
                    <dt className="text-xs text-muted-foreground">Voided</dt>
                    <dd>{[data.voided_at && when(data.voided_at), personName(data.voided_by) && `by ${personName(data.voided_by)}`, data.void_reason].filter(Boolean).join(' · ') || 'Yes'}</dd>
                  </div>
                )}
              </dl>
              {can('gift_cards.manage') && data.status === 'active' && (
                <Button variant="outline" className="self-start" onClick={() => onVoid(data)}><BanIcon data-icon="inline-start" /> Void</Button>
              )}
              {data.entries.length === 0 ? (
                <p className="text-sm text-muted-foreground">No activity yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <Table aria-label="Gift card entries">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Entry</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                        <TableHead className="text-right">Balance</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.entries.map((e, i) => (
                        <TableRow key={e.id ?? i}>
                          <TableCell className="text-sm whitespace-nowrap">{when(e.created_at)}</TableCell>
                          <TableCell className="text-sm">
                            {GIFT_CARD_ENTRY_LABELS[e.type] ?? e.type}
                            {e.reference_number && <span className="font-mono text-xs text-muted-foreground"> {e.reference_number}</span>}
                            {personName(e.created_by) && <div className="text-xs text-muted-foreground">by {personName(e.created_by)}</div>}
                          </TableCell>
                          <TableCell className={`text-right font-mono ${e.amount.startsWith('-') ? 'text-destructive' : ''}`}>{e.amount.startsWith('-') ? formatMoney(e.amount) : `+${formatMoney(e.amount)}`}</TableCell>
                          <TableCell className="text-right font-mono">{formatMoney(e.balance_after)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}

/** POS1b: gift cards sold at the till, vouchers issued here and credit notes from returns. */
export function GiftCardsPage() {
  const can = useCan()
  const { day } = useFormatters()
  const canManage = can('gift_cards.manage')
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<GiftCardStatus | typeof ALL>(ALL)
  const [kind, setKind] = useState<GiftCardKind | typeof ALL>(ALL)
  const [viewing, setViewing] = useState<string | null>(null)
  const [voiding, setVoiding] = useState<GiftCard | null>(null)
  const [issuing, setIssuing] = useState(false)
  const [issued, setIssued] = useState<IssuedCode | null>(null)
  const term = useDebouncedValue(search.trim())
  const { data, error, isPending, refetch } = useGiftCardsQuery({
    page,
    search: term || undefined,
    status: status === ALL ? undefined : status,
    kind: kind === ALL ? undefined : kind,
  })

  const showIssued = ({ gift_card: g, receipt_number }: IssuedGiftCard) =>
    setIssued({ code: g.code, kindLabel: GIFT_CARD_KINDS[g.kind], amount: g.balance, currency: g.currency, expiresAt: g.expires_at, customerName: g.customer?.name, number: receipt_number })

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Gift cards"
        description="Gift cards sold at the till, vouchers given away and credit notes from returns. Codes are shown once; only the last 4 are kept."
        actions={canManage && <Button onClick={() => setIssuing(true)}><PlusIcon data-icon="inline-start" /> Issue voucher</Button>}
      />
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-sm">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input aria-label="Search gift cards" placeholder="Last 4 of the code or customer" className="pl-8" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1) }} />
        </div>
        <Select value={status} onValueChange={(v) => { setStatus(v as GiftCardStatus | typeof ALL); setPage(1) }}>
          <SelectTrigger aria-label="Filter by status" className="w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All statuses</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="void">Void</SelectItem>
          </SelectContent>
        </Select>
        <Select value={kind} onValueChange={(v) => { setKind(v as GiftCardKind | typeof ALL); setPage(1) }}>
          <SelectTrigger aria-label="Filter by kind" className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All kinds</SelectItem>
            {(Object.keys(GIFT_CARD_KINDS) as GiftCardKind[]).map((k) => <SelectItem key={k} value={k}>{GIFT_CARD_KINDS[k]}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {isPending ? (
        <LoadingState rows={5} label="Loading gift cards" />
      ) : error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : data.items.length === 0 ? (
        <EmptyState title="No gift cards found" description="Gift cards are sold at the POS terminal; credit notes come from returns." />
      ) : (
        <>
          <div className="overflow-x-auto rounded-md border">
            <Table aria-label="Gift cards">
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead className="hidden sm:table-cell">Customer</TableHead>
                  <TableHead className="hidden text-right md:table-cell">Initial</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                  <TableHead className="hidden lg:table-cell">Valid until</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-20"><span className="sr-only">Actions</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((g) => (
                  <TableRow key={g.id}>
                    <TableCell>
                      <div className="font-mono font-medium">{maskedCode(g.code_last4)}</div>
                      <div className="text-xs text-muted-foreground">{GIFT_CARD_KINDS[g.kind] ?? g.kind}</div>
                    </TableCell>
                    <TableCell className="hidden text-sm sm:table-cell">{g.customer?.name ?? '—'}</TableCell>
                    <TableCell className="hidden text-right font-mono text-sm md:table-cell">{formatMoney(g.initial_value)}</TableCell>
                    <TableCell className="text-right font-mono text-sm">{formatMoney(g.balance, g.currency)}</TableCell>
                    <TableCell className="hidden text-sm lg:table-cell">{g.expires_at ? day(g.expires_at) : 'No expiry'}</TableCell>
                    <TableCell><StatusBadge card={g} /></TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      <Button variant="ghost" size="icon-sm" aria-label={`View ${maskedCode(g.code_last4)}`} onClick={() => setViewing(g.id)}><EyeIcon /></Button>
                      {canManage && g.status === 'active' && (
                        <Button variant="ghost" size="icon-sm" aria-label={`Void ${maskedCode(g.code_last4)}`} onClick={() => setVoiding(g)}><BanIcon /></Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <PaginationBar pagination={data.pagination} onPageChange={setPage} />
        </>
      )}

      <GiftCardSheet id={viewing} onOpenChange={(o) => !o && setViewing(null)} onVoid={setVoiding} />
      <VoidDialog card={voiding} onOpenChange={(o) => !o && setVoiding(null)} />
      {canManage && <IssueVoucherDialog open={issuing} onOpenChange={setIssuing} onIssued={showIssued} />}
      <GiftCodeDialog issued={issued} title="Voucher issued" onDone={() => setIssued(null)} />
    </div>
  )
}
