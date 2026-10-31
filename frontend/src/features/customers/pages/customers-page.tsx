import { useState } from 'react'
import { ArchiveIcon, ArchiveRestoreIcon, PencilIcon, PlusIcon, SearchIcon, Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { PageHeader } from '@/components/common/page-header'
import { PaginationBar } from '@/components/common/pagination-bar'
import { EmptyState, ErrorState, LoadingState } from '@/components/common/state-views'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useAuth, useCan } from '@/features/auth/use-auth'
import { CatalogRecordDialog } from '@/features/catalog/components/catalog-record-dialog'
import {
  useArchiveCustomerMutation,
  useCustomerGroupsQuery,
  useCustomersQuery,
  useDeleteCustomerGroupMutation,
  useSaveCustomerGroupMutation,
  type Customer,
  type CustomerGroup,
} from '@/features/customers/api'
import { CustomerDialog } from '@/features/customers/components/customer-dialog'
import { useCustomerBalancesQuery } from '@/features/sales/api'
import { decimalPattern, formatMoney } from '@/lib/money'
import { useDebouncedValue } from '@/lib/use-debounced-value'

const ALL = 'all'
type GroupValues = { name: string; description: string | null; discount_percent: string }

function GroupsTab({ canManage }: { canManage: boolean }) {
  const groups = useCustomerGroupsQuery()
  const save = useSaveCustomerGroupMutation()
  const remove = useDeleteCustomerGroupMutation()
  const [editing, setEditing] = useState<CustomerGroup | null | undefined>(undefined)
  const [defaults, setDefaults] = useState<GroupValues>({ name: '', description: null, discount_percent: '0' })
  const [deleting, setDeleting] = useState<CustomerGroup | null>(null)

  const open = (g: CustomerGroup | null) => {
    setDefaults({ name: g?.name ?? '', description: g?.description ?? null, discount_percent: g?.discount_percent ?? '0' })
    setEditing(g)
  }

  return (
    <div className="flex flex-col gap-4">
      {canManage && <Button variant="outline" className="self-start" onClick={() => open(null)}><PlusIcon data-icon="inline-start" /> New group</Button>}
      {groups.isPending ? (
        <LoadingState rows={3} label="Loading groups" />
      ) : groups.error ? (
        <ErrorState error={groups.error} onRetry={() => groups.refetch()} />
      ) : groups.data.length === 0 ? (
        <EmptyState title="No customer groups" description="Groups give members a default discount, e.g. Wholesale 5 %." />
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Discount</TableHead>
                <TableHead>Customers</TableHead>
                {canManage && <TableHead className="w-24"><span className="sr-only">Actions</span></TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {groups.data.map((g) => (
                <TableRow key={g.id}>
                  <TableCell className="font-medium">{g.name}<div className="text-xs text-muted-foreground">{g.description}</div></TableCell>
                  <TableCell>{formatMoney(g.discount_percent)} %</TableCell>
                  <TableCell>{g.customers_count ?? 0}</TableCell>
                  {canManage && (
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon-sm" aria-label={`Edit ${g.name}`} onClick={() => open(g)}><PencilIcon /></Button>
                      <Button variant="ghost" size="icon-sm" aria-label={`Delete ${g.name}`} onClick={() => setDeleting(g)}><Trash2Icon /></Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <CatalogRecordDialog<GroupValues>
        open={editing !== undefined}
        onOpenChange={(o) => !o && setEditing(undefined)}
        title={editing ? `Edit ${editing.name}` : 'New customer group'}
        fields={[
          { name: 'name', label: 'Name', type: 'text', rules: { required: 'Required.' } },
          { name: 'description', label: 'Description', type: 'text' },
          { name: 'discount_percent', label: 'Default discount (%)', type: 'text', inputMode: 'decimal', rules: { pattern: { value: decimalPattern(2), message: 'A percentage with up to 2 decimals.' } } },
        ]}
        defaultValues={defaults}
        submitLabel={editing ? 'Save changes' : 'Create group'}
        isPending={save.isPending}
        onSubmit={(values) => save.mutateAsync({ id: editing?.id, input: { ...values, discount_percent: values.discount_percent || '0' } }).then((g) => toast.success(`${g.name} saved.`))}
      />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete ${deleting?.name}?`}
        description="Only groups without customers can be deleted."
        confirmLabel="Delete"
        pending={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting.id, { onSuccess: () => toast.success(`${deleting.name} deleted.`), onError: (e) => toast.error(e.message), onSettled: () => setDeleting(null) })}
      />
    </div>
  )
}

export function CustomersPage() {
  const me = useAuth()
  const can = useCan()
  const canCreate = can('customers.create')
  const canManage = can('customers.manage')
  const currency = me.organization?.base_currency
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [groupId, setGroupId] = useState(ALL)
  const [archived, setArchived] = useState(false)
  const [editing, setEditing] = useState<Customer | null | undefined>(undefined)
  const [archiving, setArchiving] = useState<Customer | null>(null)
  const debouncedSearch = useDebouncedValue(search)
  const groups = useCustomerGroupsQuery()
  const archive = useArchiveCustomerMutation()
  const { data, error, isPending, refetch } = useCustomersQuery({ page, search: debouncedSearch || undefined, customer_group_id: groupId === ALL ? undefined : groupId, archived })
  const canSeeBalances = can('sales.view')
  const balances = useCustomerBalancesQuery(data?.items.map((c) => c.id) ?? [], canSeeBalances)

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Customers"
        description="Registered customers. Sales without a customer are walk-in sales."
        actions={canCreate && <Button onClick={() => setEditing(null)}><PlusIcon data-icon="inline-start" /> New customer</Button>}
      />
      <Tabs defaultValue="customers">
        <TabsList>
          <TabsTrigger value="customers">Customers</TabsTrigger>
          <TabsTrigger value="groups">Groups</TabsTrigger>
        </TabsList>

        <TabsContent value="customers" className="flex flex-col gap-4 pt-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative w-full max-w-sm">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input aria-label="Search customers" placeholder="Name, phone, code or e-mail" className="pl-8" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1) }} />
            </div>
            <Select value={groupId} onValueChange={(v) => { setGroupId(v); setPage(1) }}>
              <SelectTrigger aria-label="Filter by group" className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All groups</SelectItem>
                {(groups.data ?? []).map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <div className="flex items-center gap-2">
              <Switch id="customers-archived" checked={archived} onCheckedChange={(v) => { setArchived(v); setPage(1) }} />
              <Label htmlFor="customers-archived" className="font-normal">Archived</Label>
            </div>
          </div>

          {isPending ? (
            <LoadingState rows={5} label="Loading customers" />
          ) : error ? (
            <ErrorState error={error} onRetry={() => refetch()} />
          ) : data.items.length === 0 ? (
            <EmptyState title="No customers found" />
          ) : (
            <>
              <div className="overflow-x-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Customer</TableHead>
                      <TableHead>Phone</TableHead>
                      <TableHead className="hidden md:table-cell">Group</TableHead>
                      <TableHead className="hidden lg:table-cell text-right">Credit limit</TableHead>
                      {canSeeBalances && <TableHead className="text-right">Balance owed</TableHead>}
                      <TableHead>Status</TableHead>
                      {canManage && <TableHead className="w-24"><span className="sr-only">Actions</span></TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.items.map((c) => (
                      <TableRow key={c.id}>
                        <TableCell><div className="font-medium">{c.name}</div><div className="font-mono text-xs text-muted-foreground">{c.code}</div></TableCell>
                        <TableCell className="font-mono text-sm">{c.phone ?? '—'}</TableCell>
                        <TableCell className="hidden md:table-cell">{c.group ? `${c.group.name} (${formatMoney(c.group.discount_percent)} %)` : '—'}</TableCell>
                        <TableCell className="hidden text-right font-mono text-sm lg:table-cell">{c.credit_limit === '0.00' ? 'No credit' : formatMoney(c.credit_limit, currency)}</TableCell>
                        {canSeeBalances && (
                          <TableCell className="text-right font-mono text-sm">{balances.data?.[c.id] !== undefined ? formatMoney(balances.data[c.id], currency) : '…'}</TableCell>
                        )}
                        <TableCell>{c.archived_at ? <Badge variant="outline">Archived</Badge> : <Badge variant={c.is_active ? 'secondary' : 'outline'}>{c.is_active ? 'Active' : 'Inactive'}</Badge>}</TableCell>
                        {canManage && (
                          <TableCell className="text-right">
                            {c.archived_at ? (
                              <Button variant="ghost" size="icon-sm" aria-label={`Restore ${c.name}`} onClick={() => archive.mutate({ id: c.id, restore: true }, { onSuccess: () => toast.success(`${c.name} restored.`), onError: (e) => toast.error(e.message) })}>
                                <ArchiveRestoreIcon />
                              </Button>
                            ) : (
                              <>
                                <Button variant="ghost" size="icon-sm" aria-label={`Edit ${c.name}`} onClick={() => setEditing(c)}><PencilIcon /></Button>
                                <Button variant="ghost" size="icon-sm" aria-label={`Archive ${c.name}`} onClick={() => setArchiving(c)}><ArchiveIcon /></Button>
                              </>
                            )}
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
        </TabsContent>

        <TabsContent value="groups" className="pt-4">
          <GroupsTab canManage={canManage} />
        </TabsContent>
      </Tabs>

      {canCreate && (
        <CustomerDialog
          open={editing !== undefined}
          onOpenChange={(o) => !o && setEditing(undefined)}
          customer={editing ?? null}
          groups={groups.data ?? []}
          canSetTerms={canManage}
          currency={currency}
        />
      )}
      <ConfirmDialog
        open={archiving !== null}
        onOpenChange={(o) => !o && setArchiving(null)}
        title={`Archive ${archiving?.name}?`}
        description="Archived customers cannot be selected at the till. Their phone number becomes available again."
        confirmLabel="Archive"
        pending={archive.isPending}
        onConfirm={() => archiving && archive.mutate({ id: archiving.id }, { onSuccess: () => toast.success(`${archiving.name} archived.`), onError: (e) => toast.error(e.message), onSettled: () => setArchiving(null) })}
      />
    </div>
  )
}
