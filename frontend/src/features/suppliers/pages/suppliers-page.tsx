import { useEffect, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { ArchiveIcon, ArchiveRestoreIcon, Loader2Icon, PencilIcon, PlusIcon, SearchIcon } from 'lucide-react'
import { toast } from 'sonner'
import { z } from 'zod'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { FormField } from '@/components/common/form-field'
import { PageHeader } from '@/components/common/page-header'
import { PaginationBar } from '@/components/common/pagination-bar'
import { EmptyState, ErrorState, LoadingState } from '@/components/common/state-views'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { useAuth, useCan } from '@/features/auth/use-auth'
import { useArchiveSupplierMutation, useSaveSupplierMutation, useSuppliersQuery, type Supplier } from '@/features/suppliers/api'
import { handleFormError } from '@/lib/forms'
import { formatMoney } from '@/lib/money'
import { useDebouncedValue } from '@/lib/use-debounced-value'

const schema = z.object({
  code: z.string().trim().max(30).regex(/^[A-Za-z0-9\-_.]*$/, 'Letters, digits and - _ . only.'),
  name: z.string().trim().min(1, 'Required.').max(255),
  contact_person: z.string().trim().max(255),
  email: z.union([z.email('Invalid e-mail.'), z.literal('')]),
  phone: z.string().trim().max(32),
  address: z.string().trim().max(1000),
  tax_number: z.string().trim().max(64),
  payment_terms_days: z.string().regex(/^\d{1,3}$/, 'Whole days, 0–365.'),
  opening_balance: z.string().trim().regex(/^-?\d{1,16}(\.\d{1,2})?$/, 'Amount with up to 2 decimals.'),
  notes: z.string().max(5000),
  is_active: z.boolean(),
})
type Values = z.infer<typeof schema>
const FIELDS = ['code', 'name', 'contact_person', 'email', 'phone', 'address', 'tax_number', 'payment_terms_days', 'opening_balance', 'notes'] as const

const toValues = (s: Supplier | null): Values => ({
  code: s?.code ?? '', name: s?.name ?? '', contact_person: s?.contact_person ?? '', email: s?.email ?? '', phone: s?.phone ?? '',
  address: s?.address ?? '', tax_number: s?.tax_number ?? '', payment_terms_days: String(s?.payment_terms_days ?? 0),
  opening_balance: s?.opening_balance ?? '0', notes: s?.notes ?? '', is_active: s?.is_active ?? true,
})

function SupplierDialog({ supplier, open, onOpenChange }: { supplier: Supplier | null; open: boolean; onOpenChange: (open: boolean) => void }) {
  const save = useSaveSupplierMutation()
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: toValues(supplier) })
  const { errors } = form.formState

  useEffect(() => {
    if (open) form.reset(toValues(supplier))
  }, [open, supplier, form])

  const onSubmit = form.handleSubmit((v) => {
    const blank = (x: string) => x.trim() || null
    save.mutate(
      {
        id: supplier?.id,
        input: {
          code: supplier ? v.code.trim() || supplier.code : blank(v.code), name: v.name, contact_person: blank(v.contact_person), email: blank(v.email),
          phone: blank(v.phone), address: blank(v.address), tax_number: blank(v.tax_number), notes: blank(v.notes),
          payment_terms_days: Number(v.payment_terms_days), opening_balance: v.opening_balance, is_active: v.is_active,
        },
      },
      {
        onSuccess: (s) => {
          toast.success(`${s.name} (${s.code}) saved.`)
          onOpenChange(false)
        },
        onError: (e) => handleFormError(e, form.setError, FIELDS),
      },
    )
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{supplier ? `Edit ${supplier.name}` : 'New supplier'}</DialogTitle>
          <DialogDescription>Leave the code empty to number it automatically.</DialogDescription>
        </DialogHeader>
        <form id="supplier-form" onSubmit={onSubmit} noValidate className="grid gap-4 sm:grid-cols-2">
          <FormField label="Name" error={errors.name?.message}><Input {...form.register('name')} /></FormField>
          <FormField label="Code" error={errors.code?.message}><Input className="uppercase" placeholder="Auto" {...form.register('code')} /></FormField>
          <FormField label="Contact person" error={errors.contact_person?.message}><Input {...form.register('contact_person')} /></FormField>
          <FormField label="Phone" error={errors.phone?.message}><Input type="tel" {...form.register('phone')} /></FormField>
          <FormField label="E-mail" error={errors.email?.message}><Input type="email" {...form.register('email')} /></FormField>
          <FormField label="Tax / BIN number" error={errors.tax_number?.message}><Input {...form.register('tax_number')} /></FormField>
          <FormField label="Payment terms (days)" error={errors.payment_terms_days?.message}><Input inputMode="numeric" {...form.register('payment_terms_days')} /></FormField>
          <FormField label="Opening balance (we owe)" error={errors.opening_balance?.message} hint="Amount owed when you started using the system.">
            <Input inputMode="decimal" {...form.register('opening_balance')} />
          </FormField>
          <FormField label="Address" error={errors.address?.message} className="sm:col-span-2"><Textarea rows={2} {...form.register('address')} /></FormField>
          <FormField label="Notes" error={errors.notes?.message} className="sm:col-span-2"><Textarea rows={2} {...form.register('notes')} /></FormField>
          <Controller control={form.control} name="is_active" render={({ field }) => (
            <div className="flex items-center gap-2 sm:col-span-2">
              <Switch id="supplier-active" checked={field.value} onCheckedChange={field.onChange} />
              <Label htmlFor="supplier-active">Active</Label>
            </div>
          )} />
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" form="supplier-form" disabled={save.isPending}>
            {save.isPending && <Loader2Icon data-icon="inline-start" className="animate-spin" />}
            {supplier ? 'Save changes' : 'Create supplier'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function SuppliersPage() {
  const me = useAuth()
  const can = useCan()
  const canManage = can('suppliers.manage')
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [archived, setArchived] = useState(false)
  const [editing, setEditing] = useState<Supplier | null | undefined>(undefined)
  const [archiving, setArchiving] = useState<Supplier | null>(null)
  const debouncedSearch = useDebouncedValue(search)
  const archive = useArchiveSupplierMutation()
  const { data, error, isPending, refetch } = useSuppliersQuery({ page, search: debouncedSearch || undefined, archived })

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Suppliers"
        description="Who you buy from. Balances and purchase history arrive with purchasing."
        actions={canManage && <Button onClick={() => setEditing(null)}><PlusIcon data-icon="inline-start" /> New supplier</Button>}
      />
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-sm">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input aria-label="Search suppliers" placeholder="Code, name, phone or e-mail" className="pl-8" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1) }} />
        </div>
        <div className="flex items-center gap-2">
          <Switch id="suppliers-archived" checked={archived} onCheckedChange={(v) => { setArchived(v); setPage(1) }} />
          <Label htmlFor="suppliers-archived" className="font-normal">Archived</Label>
        </div>
      </div>

      {isPending ? (
        <LoadingState rows={5} label="Loading suppliers" />
      ) : error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : data.items.length === 0 ? (
        <EmptyState title="No suppliers found" />
      ) : (
        <>
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead className="hidden md:table-cell">Contact</TableHead>
                  <TableHead className="hidden sm:table-cell">Terms</TableHead>
                  <TableHead className="hidden lg:table-cell text-right">Opening balance</TableHead>
                  <TableHead>Status</TableHead>
                  {canManage && <TableHead className="w-24"><span className="sr-only">Actions</span></TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-mono text-xs">{s.code}</TableCell>
                    <TableCell className="font-medium">{s.name}</TableCell>
                    <TableCell className="hidden text-sm text-muted-foreground md:table-cell">{[s.contact_person, s.phone].filter(Boolean).join(' · ') || '—'}</TableCell>
                    <TableCell className="hidden sm:table-cell">{s.payment_terms_days ? `${s.payment_terms_days} days` : 'Cash'}</TableCell>
                    <TableCell className="hidden text-right font-mono text-sm lg:table-cell">{formatMoney(s.opening_balance, me.organization?.base_currency)}</TableCell>
                    <TableCell>{s.archived_at ? <Badge variant="outline">Archived</Badge> : <Badge variant={s.is_active ? 'secondary' : 'outline'}>{s.is_active ? 'Active' : 'Inactive'}</Badge>}</TableCell>
                    {canManage && (
                      <TableCell className="text-right">
                        {s.archived_at ? (
                          <Button variant="ghost" size="icon-sm" aria-label={`Restore ${s.name}`} onClick={() => archive.mutate({ id: s.id, restore: true }, { onSuccess: () => toast.success(`${s.name} restored.`), onError: (e) => toast.error(e.message) })}>
                            <ArchiveRestoreIcon />
                          </Button>
                        ) : (
                          <>
                            <Button variant="ghost" size="icon-sm" aria-label={`Edit ${s.name}`} onClick={() => setEditing(s)}><PencilIcon /></Button>
                            <Button variant="ghost" size="icon-sm" aria-label={`Archive ${s.name}`} onClick={() => setArchiving(s)}><ArchiveIcon /></Button>
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

      {canManage && <SupplierDialog supplier={editing ?? null} open={editing !== undefined} onOpenChange={(o) => !o && setEditing(undefined)} />}
      <ConfirmDialog
        open={archiving !== null}
        onOpenChange={(o) => !o && setArchiving(null)}
        title={`Archive ${archiving?.name}?`}
        description="Archived suppliers are hidden from pick lists but kept on past documents."
        confirmLabel="Archive"
        pending={archive.isPending}
        onConfirm={() => archiving && archive.mutate({ id: archiving.id }, { onSuccess: () => toast.success(`${archiving.name} archived.`), onError: (e) => toast.error(e.message), onSettled: () => setArchiving(null) })}
      />
    </div>
  )
}
