import { useEffect } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Loader2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { z } from 'zod'
import { FormField } from '@/components/common/form-field'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { useSaveCustomerMutation, type Customer, type CustomerGroup } from '@/features/customers/api'
import { handleFormError } from '@/lib/forms'
import { formatMoney, MONEY_PATTERN } from '@/lib/money'

const NONE = '__none__'

const schema = z.object({
  name: z.string().trim().min(1, 'Required.').max(255),
  phone: z.union([z.string().trim().regex(/^\+?[0-9 ()-]{5,32}$/, 'Digits, spaces, + ( ) - only.'), z.literal('')]),
  email: z.union([z.email('Invalid e-mail.'), z.literal('')]),
  address: z.string().trim().max(1000),
  tax_number: z.string().trim().max(64),
  notes: z.string().max(5000),
  customer_group_id: z.string().nullable(),
  credit_limit: z.string().trim().regex(MONEY_PATTERN, 'Amount with up to 2 decimals.'),
  opening_balance: z.string().trim().regex(/^-?\d{1,16}(\.\d{1,2})?$/, 'Amount with up to 2 decimals.'),
  is_active: z.boolean(),
})
type Values = z.infer<typeof schema>
const FIELDS = ['name', 'phone', 'email', 'address', 'tax_number', 'notes', 'customer_group_id', 'credit_limit', 'opening_balance', 'is_active'] as const

const toValues = (c: Customer | null): Values => ({
  name: c?.name ?? '', phone: c?.phone ?? '', email: c?.email ?? '', address: c?.address ?? '', tax_number: c?.tax_number ?? '',
  notes: c?.notes ?? '', customer_group_id: c?.group?.id ?? null, credit_limit: c?.credit_limit ?? '0',
  opening_balance: c?.opening_balance ?? '0', is_active: c?.is_active ?? true,
})

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  customer: Customer | null
  groups: CustomerGroup[]
  /** customers.manage: may set group, credit limit, opening balance and status. */
  canSetTerms: boolean
  currency?: string
}

export function CustomerDialog({ open, onOpenChange, customer, groups, canSetTerms, currency }: Props) {
  const save = useSaveCustomerMutation()
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: toValues(customer) })
  const { errors } = form.formState

  useEffect(() => {
    if (open) form.reset(toValues(customer))
  }, [open, customer, form])

  const onSubmit = form.handleSubmit((v) => {
    const blank = (x: string) => x.trim() || null
    const input = {
      name: v.name, phone: blank(v.phone), email: blank(v.email), address: blank(v.address), tax_number: blank(v.tax_number), notes: blank(v.notes),
      ...(canSetTerms ? { customer_group_id: v.customer_group_id, credit_limit: v.credit_limit, opening_balance: v.opening_balance, is_active: v.is_active } : {}),
    }
    save.mutate(
      { id: customer?.id, input },
      {
        onSuccess: (c) => {
          toast.success(`${c.name} (${c.code}) saved.`)
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
          <DialogTitle>{customer ? `Edit ${customer.name}` : 'New customer'}</DialogTitle>
          <DialogDescription>The phone number is used to find the customer at the till.</DialogDescription>
        </DialogHeader>
        <form id="customer-form" onSubmit={onSubmit} noValidate className="grid gap-4 sm:grid-cols-2">
          <FormField label="Name" error={errors.name?.message}><Input autoFocus {...form.register('name')} /></FormField>
          <FormField label="Phone" error={errors.phone?.message}><Input type="tel" {...form.register('phone')} /></FormField>
          <FormField label="E-mail" error={errors.email?.message}><Input type="email" {...form.register('email')} /></FormField>
          <FormField label="Tax / BIN number" error={errors.tax_number?.message}><Input {...form.register('tax_number')} /></FormField>
          <FormField label="Address" error={errors.address?.message} className="sm:col-span-2"><Textarea rows={2} {...form.register('address')} /></FormField>

          {canSetTerms && (
            <>
              <FormField label="Customer group" error={errors.customer_group_id?.message}>
                <Controller control={form.control} name="customer_group_id" render={({ field }) => (
                  <Select value={field.value ?? NONE} onValueChange={(val) => field.onChange(val === NONE ? null : val)}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>No group</SelectItem>
                      {groups.map((g) => <SelectItem key={g.id} value={g.id}>{g.name} ({formatMoney(g.discount_percent)} %)</SelectItem>)}
                    </SelectContent>
                  </Select>
                )} />
              </FormField>
              <FormField label={`Credit limit${currency ? ` (${currency})` : ''}`} error={errors.credit_limit?.message} hint="0 = no credit sales.">
                <Input inputMode="decimal" {...form.register('credit_limit')} />
              </FormField>
              <FormField label="Opening balance (owed to you)" error={errors.opening_balance?.message}>
                <Input inputMode="decimal" {...form.register('opening_balance')} />
              </FormField>
              <Controller control={form.control} name="is_active" render={({ field }) => (
                <div className="flex items-center gap-2 self-end pb-2">
                  <Switch id="customer-active" checked={field.value} onCheckedChange={field.onChange} />
                  <Label htmlFor="customer-active">Active</Label>
                </div>
              )} />
            </>
          )}
          <FormField label="Notes" error={errors.notes?.message} className="sm:col-span-2"><Textarea rows={2} {...form.register('notes')} /></FormField>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" form="customer-form" disabled={save.isPending}>
            {save.isPending && <Loader2Icon data-icon="inline-start" className="animate-spin" />}
            {customer ? 'Save changes' : 'Create customer'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
