import { useRef, useState } from 'react'
import { Link } from 'react-router'
import { AlertTriangleIcon, BanIcon, Loader2Icon, PencilIcon, PlusIcon, Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { FormField } from '@/components/common/form-field'
import { ExportMenu } from '@/components/common/export-menu'
import { PageHeader } from '@/components/common/page-header'
import { PaginationBar } from '@/components/common/pagination-bar'
import { EmptyState, ErrorState, LoadingState } from '@/components/common/state-views'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { useAuth, useCan } from '@/features/auth/use-auth'
import {
  ENTRY_TYPES,
  useCreateExpenseMutation,
  useDeleteExpenseCategoryMutation,
  useExpenseCategoriesQuery,
  expensesListQuery,
  useExpensesQuery,
  useSaveExpenseCategoryMutation,
  useVoidExpenseMutation,
  type EntryType,
  type Expense,
  type ExpenseCategory,
} from '@/features/expenses/api'
import { isRetryable } from '@/features/returns/api'
import { ApiError } from '@/lib/api/client'
import { fieldErrorMap } from '@/lib/forms'
import { formatMoney, isZeroDecimal, MONEY_PATTERN } from '@/lib/money'
import { MONEY_METHODS, type MoneyMethod } from '@/lib/payment-methods'
import { useDebouncedValue } from '@/lib/use-debounced-value'
import { useSessionStore } from '@/stores/session-store'

const ALL = 'all'
const todayIso = () => new Date().toLocaleDateString('en-CA')
const monthStartIso = () => `${todayIso().slice(0, 8)}01`

type Draft = { categoryId: string; amount: string; method: MoneyMethod; occurredOn: string; party: string; reference: string; notes: string }
const emptyDraft = (): Draft => ({ categoryId: '', amount: '', method: 'cash', occurredOn: todayIso(), party: '', reference: '', notes: '' })

/** Mounted inside DialogContent, so each opening starts with an empty entry. */
function EntryForm({ type, onOpenChange, create }: { type: EntryType; onOpenChange: (open: boolean) => void; create: ReturnType<typeof useCreateExpenseMutation> }) {
  const me = useAuth()
  const branchId = useSessionStore((s) => s.activeBranchId)
  const branch = me.branches.find((b) => b.id === branchId)
  const categories = useExpenseCategoriesQuery(type)
  const [draft, setDraft] = useState<Draft>(emptyDraft)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [needsSession, setNeedsSession] = useState(false)
  const pending = useRef<{ fingerprint: string; key: string } | null>(null)
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }))
  const t = ENTRY_TYPES[type]

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!branchId) return
    const local: Record<string, string> = {}
    if (!draft.categoryId) local.expense_category_id = 'Choose a category.'
    if (!MONEY_PATTERN.test(draft.amount.trim()) || isZeroDecimal(draft.amount)) local.amount = 'An amount greater than zero with up to 2 decimals.'
    if (Object.keys(local).length > 0) return setErrors(local)

    const input = {
      type,
      branch_id: branchId,
      expense_category_id: draft.categoryId,
      amount: draft.amount.trim(),
      method: draft.method,
      occurred_on: draft.occurredOn,
      reference: draft.reference.trim() || null,
      party: draft.party.trim() || null,
      notes: draft.notes.trim() || null,
    }
    const fingerprint = JSON.stringify(input)
    if (pending.current?.fingerprint !== fingerprint) pending.current = { fingerprint, key: crypto.randomUUID() }

    create.mutate({ input, idempotencyKey: pending.current.key }, {
      onSuccess: (x) => {
        pending.current = null
        toast.success(`${x.number}: ${formatMoney(x.amount, x.currency)} recorded.`)
        onOpenChange(false)
      },
      onError: (err) => {
        if (!isRetryable(err)) pending.current = null
        setNeedsSession(err instanceof ApiError && err.code === 'CASH_SESSION_REQUIRED')
        setErrors(fieldErrorMap(err))
      },
    })
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>New {t.label.toLowerCase()}</DialogTitle>
        <DialogDescription>{branch ? `Booked to ${branch.name}.` : 'Choose a branch in the header first.'} Cash {type === 'expense' ? 'comes out of' : 'goes into'} your open register session.</DialogDescription>
      </DialogHeader>
      <form id="expense-form" onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
        <FormField label="Category" error={errors.expense_category_id} className="sm:col-span-2">
          <Select value={draft.categoryId} onValueChange={(v) => set({ categoryId: v })}>
            <SelectTrigger className="w-full" aria-label="Category"><SelectValue placeholder={categories.isPending ? 'Loading…' : 'Choose a category'} /></SelectTrigger>
            <SelectContent>{(categories.data ?? []).filter((c) => c.is_active).map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
          </Select>
        </FormField>
        <FormField label="Amount" error={errors.amount}>
          <Input inputMode="decimal" className="font-mono" value={draft.amount} onChange={(e) => set({ amount: e.target.value })} />
        </FormField>
        <FormField label="Method" error={errors.method}>
          <Select value={draft.method} onValueChange={(v) => set({ method: v as MoneyMethod })}>
            <SelectTrigger className="w-full" aria-label="Payment method"><SelectValue /></SelectTrigger>
            <SelectContent>{(Object.keys(MONEY_METHODS) as MoneyMethod[]).map((m) => <SelectItem key={m} value={m}>{MONEY_METHODS[m]}</SelectItem>)}</SelectContent>
          </Select>
        </FormField>
        <FormField label="Date" error={errors.occurred_on}>
          <Input type="date" max={todayIso()} value={draft.occurredOn} onChange={(e) => set({ occurredOn: e.target.value || todayIso() })} />
        </FormField>
        <FormField label={type === 'expense' ? 'Paid to' : 'Received from'} error={errors.party}>
          <Input maxLength={150} value={draft.party} onChange={(e) => set({ party: e.target.value })} />
        </FormField>
        <FormField label="Reference" error={errors.reference} className="sm:col-span-2">
          <Input maxLength={100} value={draft.reference} onChange={(e) => set({ reference: e.target.value })} placeholder="Bill / voucher no." />
        </FormField>
        <FormField label="Notes" error={errors.notes} className="sm:col-span-2">
          <Textarea rows={2} maxLength={1000} value={draft.notes} onChange={(e) => set({ notes: e.target.value })} />
        </FormField>
      </form>
      {errors.form && (
        <div role="alert" className="flex gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
          <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
          <span>
            {errors.form}
            {needsSession && <> Open a session on <Link to="/cash-registers" className="underline">Cash registers</Link>, or use another method.</>}
          </span>
        </div>
      )}
      <DialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)} disabled={create.isPending}>Cancel</Button>
        <Button type="submit" form="expense-form" disabled={create.isPending || !branchId}>
          {create.isPending && <Loader2Icon data-icon="inline-start" className="animate-spin" />}
          Record {t.label.toLowerCase()}
        </Button>
      </DialogFooter>
    </>
  )
}

function EntryDialog({ type, open, onOpenChange }: { type: EntryType; open: boolean; onOpenChange: (open: boolean) => void }) {
  const create = useCreateExpenseMutation()
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!create.isPending) onOpenChange(o) }}>
      <DialogContent className="sm:max-w-lg">
        <EntryForm type={type} onOpenChange={onOpenChange} create={create} />
      </DialogContent>
    </Dialog>
  )
}

function EntriesTab({ type, canManage }: { type: EntryType; canManage: boolean }) {
  const me = useAuth()
  const currency = me.organization?.base_currency
  const t = ENTRY_TYPES[type]
  const [page, setPage] = useState(1)
  const [from, setFrom] = useState(monthStartIso)
  const [to, setTo] = useState(todayIso)
  const [categoryId, setCategoryId] = useState(ALL)
  const [voided, setVoided] = useState(false)
  const [search, setSearch] = useState('')
  const [creating, setCreating] = useState(false)
  const [voiding, setVoiding] = useState<Expense | null>(null)
  const [voidReason, setVoidReason] = useState('')
  const term = useDebouncedValue(search.trim())
  const categories = useExpenseCategoriesQuery(type)
  const voidEntry = useVoidExpenseMutation()
  const filters = { type, from, to, voided, expense_category_id: categoryId === ALL ? undefined : categoryId, search: term || undefined }
  const { data, error, isPending, refetch } = useExpensesQuery({ page, ...filters })

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${type}-from`}>From</Label>
          <Input id={`${type}-from`} type="date" className="w-40" value={from} max={to} onChange={(e) => { setFrom(e.target.value || from); setPage(1) }} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${type}-to`}>To</Label>
          <Input id={`${type}-to`} type="date" className="w-40" value={to} min={from} max={todayIso()} onChange={(e) => { setTo(e.target.value || to); setPage(1) }} />
        </div>
        <Select value={categoryId} onValueChange={(v) => { setCategoryId(v); setPage(1) }}>
          <SelectTrigger className="w-48" aria-label="Filter by category"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All categories</SelectItem>
            {(categories.data ?? []).map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input aria-label={`Search ${t.plural.toLowerCase()}`} placeholder="Number, party or reference" className="max-w-xs" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1) }} />
        <div className="flex items-center gap-2 pb-2">
          <Switch id={`${type}-voided`} checked={voided} onCheckedChange={(v) => { setVoided(v); setPage(1) }} />
          <Label htmlFor={`${type}-voided`} className="font-normal">Voided</Label>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <ExportMenu list="expenses" query={expensesListQuery(filters)} disabled={!data?.items.length} />
          {canManage && <Button onClick={() => setCreating(true)}><PlusIcon data-icon="inline-start" /> New {t.label.toLowerCase()}</Button>}
        </div>
      </div>

      {data && data.total !== null && (
        <div className="flex flex-col gap-2">
          <Card size="sm" className="self-start">
            <CardContent>
              <CardTitle className="mb-2">{voided ? `Voided ${t.plural.toLowerCase()}` : `Total ${t.plural.toLowerCase()}`}</CardTitle>
              <div className="font-mono text-xl font-bold text-primary" data-testid={`${type}-total`}>{formatMoney(data.total, currency)}</div>
            </CardContent>
          </Card>
          {data.byCategory.length > 0 && (
            <div className="flex flex-wrap gap-2 text-sm" aria-label="By category">
              {data.byCategory.map((c) => <Badge key={c.id} variant="outline" className="font-normal">{c.name}: <span className="font-mono">{formatMoney(c.total)}</span> ({c.entries})</Badge>)}
            </div>
          )}
        </div>
      )}

      {isPending ? (
        <LoadingState rows={5} label={`Loading ${t.plural.toLowerCase()}`} />
      ) : error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : data.items.length === 0 ? (
        <EmptyState title={`No ${t.plural.toLowerCase()} in this period`} />
      ) : (
        <>
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Number</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead className="hidden md:table-cell">{type === 'expense' ? 'Paid to' : 'From'}</TableHead>
                  <TableHead className="hidden sm:table-cell">Method</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  {canManage && !voided && <TableHead><span className="sr-only">Actions</span></TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((x) => (
                  <TableRow key={x.id}>
                    <TableCell className="font-mono text-sm">{x.number}</TableCell>
                    <TableCell className="text-sm whitespace-nowrap">{x.occurred_on}</TableCell>
                    <TableCell className="text-sm">
                      {x.category.name}
                      {x.notes && <div className="text-xs text-muted-foreground">{x.notes}</div>}
                      {x.voided_at && <div className="text-xs text-destructive">Voided by {x.voided_by?.name ?? '—'}: {x.void_reason}</div>}
                    </TableCell>
                    <TableCell className="hidden text-sm md:table-cell">{x.party ?? '—'}</TableCell>
                    <TableCell className="hidden text-sm sm:table-cell">{x.method_label}{x.reference && <div className="text-xs text-muted-foreground">{x.reference}</div>}</TableCell>
                    <TableCell className="text-right font-mono">{formatMoney(x.amount, x.currency)}</TableCell>
                    {canManage && !voided && (
                      <TableCell className="text-right">
                        <Button variant="ghost" size="icon-sm" aria-label={`Void ${x.number}`} onClick={() => { setVoidReason(''); setVoiding(x) }}><BanIcon /></Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <PaginationBar pagination={data.pagination} onPageChange={setPage} />
        </>
      )}

      {canManage && <EntryDialog type={type} open={creating} onOpenChange={setCreating} />}
      <Dialog open={voiding !== null} onOpenChange={(o) => { if (!o && !voidEntry.isPending) setVoiding(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Void {voiding?.number}?</DialogTitle>
            <DialogDescription>An opposite payment of {voiding && formatMoney(voiding.amount, voiding.currency)} is booked{voiding?.method === 'cash' ? ' through your open register session' : ''}. The entry stays listed under Voided.</DialogDescription>
          </DialogHeader>
          <form
            id="void-expense-form"
            className="flex flex-col gap-1.5"
            onSubmit={(e) => {
              e.preventDefault()
              if (!voiding || !voidReason.trim()) return
              voidEntry.mutate({ id: voiding.id, reason: voidReason.trim() }, {
                onSuccess: (x) => { toast.success(`${x.number} voided.`); setVoiding(null) },
                onError: (err) => toast.error(err instanceof ApiError ? err.message : 'Could not void the entry.'),
              })
            }}
          >
            <Label htmlFor="void-reason">Reason</Label>
            <Input id="void-reason" autoFocus maxLength={255} value={voidReason} onChange={(e) => setVoidReason(e.target.value)} placeholder="e.g. entered twice" />
          </form>
          <DialogFooter>
            <Button variant="outline" onClick={() => setVoiding(null)}>Keep</Button>
            <Button type="submit" form="void-expense-form" variant="destructive" disabled={!voidReason.trim() || voidEntry.isPending}>Void</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function CategoriesTab({ canManage }: { canManage: boolean }) {
  const categories = useExpenseCategoriesQuery()
  const save = useSaveExpenseCategoryMutation()
  const remove = useDeleteExpenseCategoryMutation()
  const [editing, setEditing] = useState<ExpenseCategory | null | undefined>(undefined)
  const [deleting, setDeleting] = useState<ExpenseCategory | null>(null)
  const [type, setType] = useState<EntryType>('expense')
  const [name, setName] = useState('')
  const [active, setActive] = useState(true)
  const [errors, setErrors] = useState<Record<string, string>>({})

  const open = (c: ExpenseCategory | null) => {
    setType(c?.type ?? 'expense')
    setName(c?.name ?? '')
    setActive(c?.is_active ?? true)
    setErrors({})
    setEditing(c)
  }

  return (
    <div className="flex flex-col gap-4">
      {canManage && <Button variant="outline" className="self-start" onClick={() => open(null)}><PlusIcon data-icon="inline-start" /> New category</Button>}
      {categories.isPending ? (
        <LoadingState rows={3} label="Loading categories" />
      ) : categories.error ? (
        <ErrorState error={categories.error} onRetry={() => categories.refetch()} />
      ) : categories.data.length === 0 ? (
        <EmptyState title="No categories" description="E.g. Rent, Utilities, Salaries; Scrap sales for other income." />
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Category</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Status</TableHead>
                {canManage && <TableHead><span className="sr-only">Actions</span></TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {categories.data.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">{c.name}</TableCell>
                  <TableCell className="text-sm">{ENTRY_TYPES[c.type].label}</TableCell>
                  <TableCell><Badge variant={c.is_active ? 'success' : 'outline'}>{c.is_active ? 'Active' : 'Inactive'}</Badge></TableCell>
                  {canManage && (
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon-sm" aria-label={`Edit ${c.name}`} onClick={() => open(c)}><PencilIcon /></Button>
                      <Button variant="ghost" size="icon-sm" aria-label={`Delete ${c.name}`} onClick={() => setDeleting(c)}><Trash2Icon /></Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={editing !== undefined} onOpenChange={(o) => { if (!o && !save.isPending) setEditing(undefined) }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? `Edit ${editing.name}` : 'New category'}</DialogTitle></DialogHeader>
          <form
            id="expense-category-form"
            noValidate
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault()
              const input = editing ? { name: name.trim(), is_active: active } : { type, name: name.trim(), is_active: active }
              save.mutate({ id: editing?.id, input }, {
                onSuccess: (c) => { toast.success(`${c.name} saved.`); setEditing(undefined) },
                onError: (err) => setErrors(fieldErrorMap(err)),
              })
            }}
          >
            {!editing && (
              <FormField label="Type" error={errors.type}>
                <Select value={type} onValueChange={(v) => setType(v as EntryType)}>
                  <SelectTrigger className="w-full" aria-label="Type"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="expense">Expense</SelectItem>
                    <SelectItem value="income">Other income</SelectItem>
                  </SelectContent>
                </Select>
              </FormField>
            )}
            <FormField label="Name" error={errors.name}>
              <Input autoFocus maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
            </FormField>
            <div className="flex items-center gap-2">
              <Switch id="expense-category-active" checked={active} onCheckedChange={setActive} />
              <Label htmlFor="expense-category-active" className="font-normal">Active</Label>
            </div>
            {errors.form && <p role="alert" className="text-sm text-destructive">{errors.form}</p>}
          </form>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(undefined)} disabled={save.isPending}>Cancel</Button>
            <Button type="submit" form="expense-category-form" disabled={save.isPending || !name.trim()}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete ${deleting?.name}?`}
        description="Only categories without entries can be deleted; deactivate it otherwise."
        confirmLabel="Delete"
        destructive
        pending={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting.id, { onSuccess: () => toast.success(`${deleting.name} deleted.`), onError: (e) => toast.error(e.message), onSettled: () => setDeleting(null) })}
      />
    </div>
  )
}

export function ExpensesPage() {
  const can = useCan()
  const canManage = can('expenses.manage')

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Expenses" description="Running costs paid out and other income received, outside sales and purchases." />
      <Tabs defaultValue="expense">
        <TabsList>
          <TabsTrigger value="expense">Expenses</TabsTrigger>
          <TabsTrigger value="income">Other income</TabsTrigger>
          <TabsTrigger value="categories">Categories</TabsTrigger>
        </TabsList>
        <TabsContent value="expense" className="pt-4"><EntriesTab type="expense" canManage={canManage} /></TabsContent>
        <TabsContent value="income" className="pt-4"><EntriesTab type="income" canManage={canManage} /></TabsContent>
        <TabsContent value="categories" className="pt-4"><CategoriesTab canManage={canManage} /></TabsContent>
      </Tabs>
    </div>
  )
}
