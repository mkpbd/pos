import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { ArrowDownToLineIcon, ArrowLeftIcon, ArrowUpFromLineIcon, LockIcon, PencilIcon, PlayIcon, PlusIcon } from 'lucide-react'
import { toast } from 'sonner'
import { FormField } from '@/components/common/form-field'
import { PageHeader } from '@/components/common/page-header'
import { PaginationBar } from '@/components/common/pagination-bar'
import { EmptyState, ErrorState, LoadingState } from '@/components/common/state-views'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useAuth, useCan } from '@/features/auth/use-auth'
import { SectionTabs } from '@/features/inventory/components/inventory-tabs'
import { REGISTER_TABS } from '@/features/inventory/sections'
import { CashMovementDialog, CloseSessionDialog, OpenSessionDialog } from '@/features/registers/components/session-dialogs'
import { SessionReportView } from '@/features/registers/components/session-report'
import {
  useCashRegistersQuery,
  useCurrentSessionQuery,
  useRegisterSessionsQuery,
  useSaveCashRegisterMutation,
  useSessionReportQuery,
  varianceTone,
  type CashRegister,
  type SessionStatus,
} from '@/features/registers/api'
import type { PaymentDirection } from '@/features/payments/api'
import { fieldErrorMap } from '@/lib/forms'
import { formatMoney } from '@/lib/money'
import { useSessionStore } from '@/stores/session-store'

/** Mounted inside DialogContent, so each opening starts from the register's current values. */
function RegisterForm({ register, onOpenChange, save }: { register: CashRegister | null; onOpenChange: (open: boolean) => void; save: ReturnType<typeof useSaveCashRegisterMutation> }) {
  const me = useAuth()
  const activeBranchId = useSessionStore((s) => s.activeBranchId)
  const [branchId, setBranchId] = useState(register?.branch?.id ?? activeBranchId ?? '')
  const [code, setCode] = useState(register?.code ?? '')
  const [name, setName] = useState(register?.name ?? '')
  const [active, setActive] = useState(register?.is_active ?? true)
  const [errors, setErrors] = useState<Record<string, string>>({})

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const input = { ...(register ? {} : { branch_id: branchId }), code: code.trim(), name: name.trim(), is_active: active }
    save.mutate({ id: register?.id, input }, {
      onSuccess: (r) => { toast.success(`${r.name} saved.`); onOpenChange(false) },
      onError: (err) => setErrors(fieldErrorMap(err)),
    })
  }

  return (
    <>
      <DialogHeader><DialogTitle>{register ? `Edit ${register.name}` : 'New cash register'}</DialogTitle></DialogHeader>
      <form id="register-form" onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
        {!register && (
          <FormField label="Branch" error={errors.branch_id} className="sm:col-span-2">
            <Select value={branchId} onValueChange={setBranchId}>
              <SelectTrigger className="w-full" aria-label="Branch"><SelectValue placeholder="Choose a branch" /></SelectTrigger>
              <SelectContent>{me.branches.filter((b) => b.is_active).map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}</SelectContent>
            </Select>
          </FormField>
        )}
        <FormField label="Code" error={errors.code}>
          <Input maxLength={30} className="font-mono uppercase" value={code} onChange={(e) => setCode(e.target.value)} placeholder="REG-02" />
        </FormField>
        <FormField label="Name" error={errors.name}>
          <Input maxLength={100} value={name} onChange={(e) => setName(e.target.value)} placeholder="Counter 2" />
        </FormField>
        <div className="flex items-center gap-2 sm:col-span-2">
          <Switch id="register-active" checked={active} onCheckedChange={setActive} />
          <Label htmlFor="register-active" className="font-normal">Active (can open sessions)</Label>
        </div>
        {errors.form && <p role="alert" className="text-sm text-destructive sm:col-span-2">{errors.form}</p>}
      </form>
      <DialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)} disabled={save.isPending}>Cancel</Button>
        <Button type="submit" form="register-form" disabled={save.isPending || (!register && !branchId)}>Save</Button>
      </DialogFooter>
    </>
  )
}

function RegisterDialog({ register, onOpenChange }: { register: CashRegister | null | undefined; onOpenChange: (open: boolean) => void }) {
  const save = useSaveCashRegisterMutation()
  return (
    <Dialog open={register !== undefined} onOpenChange={(o) => { if (!save.isPending) onOpenChange(o) }}>
      <DialogContent>
        {register !== undefined && <RegisterForm register={register} onOpenChange={onOpenChange} save={save} />}
      </DialogContent>
    </Dialog>
  )
}

/** The caller's own open shift, with shortcuts to its report. */
function MySessionCard() {
  const current = useCurrentSessionQuery()
  const session = current.data
  if (current.isPending || current.error || !session) return null

  return (
    <Card size="sm">
      <CardContent className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-xs text-muted-foreground">Your open session</div>
          <div className="font-medium">
            <span className="font-mono">{session.number}</span> · {session.register?.name} · since {new Date(session.opened_at).toLocaleTimeString()}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">Expected cash <span className="font-mono font-semibold text-foreground">{formatMoney(session.cash.expected, session.currency)}</span></span>
          <Button asChild size="sm"><Link to={`/cash-registers/sessions/${session.id}`}>Open report</Link></Button>
        </div>
      </CardContent>
    </Card>
  )
}

export function CashRegistersPage() {
  const can = useCan()
  const navigate = useNavigate()
  const branchId = useSessionStore((s) => s.activeBranchId) ?? undefined
  const canOperate = can('cash_registers.operate')
  const canManage = can('cash_registers.manage')
  const { data, error, isPending, refetch } = useCashRegistersQuery({})
  const current = useCurrentSessionQuery(canOperate)
  const [editing, setEditing] = useState<CashRegister | null | undefined>(undefined)
  const [opening, setOpening] = useState<CashRegister | null>(null)

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Cash registers"
        description="Tills per branch. A cashier opens a session with a counted float, and closes it with a count at the end of the shift."
        actions={canManage && <Button onClick={() => setEditing(null)}><PlusIcon data-icon="inline-start" /> New register</Button>}
      />
      <SectionTabs tabs={REGISTER_TABS} label="Cash register sections" />
      {canOperate && <MySessionCard />}

      {isPending ? (
        <LoadingState rows={3} label="Loading registers" />
      ) : error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : data.length === 0 ? (
        <EmptyState title="No cash registers yet" description={canManage ? 'Add one register per till.' : 'A manager adds registers per till.'} />
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Register</TableHead>
                <TableHead>Branch</TableHead>
                <TableHead>Session</TableHead>
                <TableHead><span className="sr-only">Actions</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <div className="font-medium">{r.name}</div>
                    <div className="font-mono text-xs text-muted-foreground">{r.code}</div>
                  </TableCell>
                  <TableCell className="text-sm">{r.branch?.name ?? '—'}</TableCell>
                  <TableCell className="text-sm">
                    {!r.is_active ? (
                      <Badge variant="outline">Inactive</Badge>
                    ) : r.open_session ? (
                      <span className="flex flex-wrap items-center gap-2">
                        <Badge variant="success">Open</Badge>
                        <span className="font-mono text-xs">{r.open_session.number}</span>
                        <span className="text-muted-foreground">{r.open_session.opened_by.name}</span>
                      </span>
                    ) : (
                      <Badge variant="secondary">Free</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    {r.open_session && (can('cash_registers.view') || current.data?.id === r.open_session.id) && (
                      <Button variant="ghost" size="sm" onClick={() => navigate(`/cash-registers/sessions/${r.open_session?.id}`)}>Report</Button>
                    )}
                    {canOperate && r.is_active && !r.open_session && !current.data && r.branch?.id === branchId && (
                      <Button variant="outline" size="sm" onClick={() => setOpening(r)}><PlayIcon data-icon="inline-start" /> Open session</Button>
                    )}
                    {canManage && <Button variant="ghost" size="icon-sm" aria-label={`Edit ${r.name}`} onClick={() => setEditing(r)}><PencilIcon /></Button>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {canManage && <RegisterDialog register={editing} onOpenChange={(o) => !o && setEditing(undefined)} />}
      <OpenSessionDialog
        open={opening !== null}
        onOpenChange={(o) => !o && setOpening(null)}
        branchId={opening?.branch?.id}
        registerId={opening?.id}
        onOpened={(report) => navigate(`/cash-registers/sessions/${report.id}`)}
      />
    </div>
  )
}

export function RegisterSessionsPage() {
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState<SessionStatus | 'all'>('all')
  const { data, error, isPending, refetch } = useRegisterSessionsQuery({ page, status: status === 'all' ? undefined : status })

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Cash registers" description="Shifts with their cash reconciliation (X report while open, Z report once closed)." />
      <SectionTabs tabs={REGISTER_TABS} label="Cash register sections" />
      <Select value={status} onValueChange={(v) => { setStatus(v as SessionStatus | 'all'); setPage(1) }}>
        <SelectTrigger className="w-40" aria-label="Filter by status"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All sessions</SelectItem>
          <SelectItem value="open">Open</SelectItem>
          <SelectItem value="closed">Closed</SelectItem>
        </SelectContent>
      </Select>

      {isPending ? (
        <LoadingState rows={5} label="Loading sessions" />
      ) : error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : data.items.length === 0 ? (
        <EmptyState title="No sessions" />
      ) : (
        <>
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Session</TableHead>
                  <TableHead className="hidden md:table-cell">Register</TableHead>
                  <TableHead>Opened</TableHead>
                  <TableHead className="text-right">Float</TableHead>
                  <TableHead className="hidden text-right sm:table-cell">Expected</TableHead>
                  <TableHead className="hidden text-right sm:table-cell">Counted</TableHead>
                  <TableHead className="text-right">Variance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((s) => {
                  const tone = varianceTone(s.variance)
                  return (
                    <TableRow key={s.id}>
                      <TableCell>
                        <Link to={`/cash-registers/sessions/${s.id}`} className="font-mono text-sm underline-offset-4 hover:underline">{s.number}</Link>
                        {s.status === 'open' && <Badge variant="success" className="ml-2">Open</Badge>}
                      </TableCell>
                      <TableCell className="hidden text-sm md:table-cell">{s.register?.name} · {s.branch?.name}</TableCell>
                      <TableCell className="text-sm">{new Date(s.opened_at).toLocaleString()}<div className="text-xs text-muted-foreground">{s.opened_by.name}</div></TableCell>
                      <TableCell className="text-right font-mono">{formatMoney(s.opening_float)}</TableCell>
                      <TableCell className="hidden text-right font-mono sm:table-cell">{formatMoney(s.expected_cash)}</TableCell>
                      <TableCell className="hidden text-right font-mono sm:table-cell">{formatMoney(s.counted_cash)}</TableCell>
                      <TableCell className="text-right">
                        {tone ? <span className="flex items-center justify-end gap-2 font-mono">{formatMoney(s.variance)} <Badge variant={tone.variant}>{tone.label}</Badge></span> : '—'}
                      </TableCell>
                    </TableRow>
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

export function RegisterSessionPage() {
  const { sessionId } = useParams()
  const can = useCan()
  const { data: report, error, isPending, refetch } = useSessionReportQuery(sessionId)
  const current = useCurrentSessionQuery(can('cash_registers.operate'))
  const [moving, setMoving] = useState<PaymentDirection | null>(null)
  const [closing, setClosing] = useState(false)

  if (isPending) return <LoadingState rows={6} label="Loading session" />
  if (error) return <ErrorState error={error} onRetry={() => refetch()} />

  const mine = current.data?.id === report.id
  const open = report.status === 'open'

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button asChild variant="ghost" size="icon" aria-label="Back to sessions"><Link to="/cash-registers/sessions"><ArrowLeftIcon /></Link></Button>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">{report.number}</h1>
          {open ? <Badge variant="success">Open</Badge> : <Badge variant="secondary">Closed</Badge>}
        </div>
        {open && (
          <div className="flex flex-wrap gap-2">
            {mine && (
              <>
                <Button variant="outline" onClick={() => setMoving('in')}><ArrowDownToLineIcon data-icon="inline-start" /> Cash in</Button>
                <Button variant="outline" onClick={() => setMoving('out')}><ArrowUpFromLineIcon data-icon="inline-start" /> Cash out</Button>
              </>
            )}
            {(mine || can('cash_registers.manage')) && <Button onClick={() => setClosing(true)}><LockIcon data-icon="inline-start" /> Close session</Button>}
          </div>
        )}
      </div>

      <SessionReportView report={report} />

      {mine && moving && <CashMovementDialog open onOpenChange={(o) => !o && setMoving(null)} session={report} direction={moving} />}
      <CloseSessionDialog open={closing} onOpenChange={setClosing} session={report} />
    </div>
  )
}
