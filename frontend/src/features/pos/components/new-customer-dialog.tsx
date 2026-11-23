import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Loader2Icon, UserCheckIcon } from 'lucide-react'
import { toast } from 'sonner'
import { z } from 'zod'
import { FormField } from '@/components/common/form-field'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useSaveCustomerMutation, type Customer } from '@/features/customers/api'
import type { CustomerRef } from '@/features/pos/cart-store'
import { normalizePhone, prefillFromSearch } from '@/features/pos/customer-phone'
import { api, ApiError } from '@/lib/api/client'
import { handleFormError } from '@/lib/forms'
import { MONEY_PATTERN } from '@/lib/money'

const schema = z.object({
  name: z.string().trim().min(1, 'Enter the customer’s name.').max(255),
  phone: z.union([z.string().trim().regex(/^\+?[0-9 ()-]{5,32}$/, 'Digits, spaces, + ( ) - only.'), z.literal('')]),
  email: z.union([z.email('Enter a valid e-mail address.'), z.literal('')]),
  address: z.string().trim().max(1000),
  credit_limit: z.string().trim().regex(MONEY_PATTERN, 'Amount with up to 2 decimals.'),
})
type Values = z.infer<typeof schema>
const FIELDS = ['name', 'phone', 'email', 'address', 'credit_limit'] as const

async function findByPhone(phone: string): Promise<Customer | null> {
  const wanted = normalizePhone(phone)
  const result = await api.get<Customer[]>('/customers', { query: { search: wanted, page: 1 } })
  return result.data.find((c) => c.phone !== null && normalizePhone(c.phone) === wanted) ?? null
}

const toRef = (c: Customer): CustomerRef => ({ id: c.id, code: c.code, name: c.name, phone: c.phone })

type Props = {
  /** Initial text from the customer search. */
  search: string
  /** customers.manage: may also set a credit limit. */
  canSetTerms: boolean
  currency?: string
  onSelect: (customer: CustomerRef) => void
  onClose: () => void
}

/**
 * "New customer" at the till (Q1 §2): creates the customer through POST /customers and selects it
 * in the cart. A phone that already belongs to a customer offers that customer instead.
 */
export function NewCustomerDialog({ search, canSetTerms, currency, onSelect, onClose }: Props) {
  const save = useSaveCustomerMutation()
  const [existing, setExisting] = useState<Customer | null>(null)
  const [lookingUp, setLookingUp] = useState(false)
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { ...prefillFromSearch(search), email: '', address: '', credit_limit: '0' },
  })
  const { errors } = form.formState

  const onSubmit = form.handleSubmit((v) => {
    setExisting(null)
    const blank = (x: string) => x.trim() || null
    const input = {
      name: v.name.trim(),
      phone: blank(v.phone),
      email: blank(v.email),
      address: blank(v.address),
      tax_number: null,
      notes: null,
      ...(canSetTerms ? { credit_limit: v.credit_limit.trim() } : {}),
    }
    save.mutate(
      { input },
      {
        onSuccess: (created) => {
          toast.success(`${created.name} (${created.code}) added and selected.`)
          onSelect(toRef(created))
        },
        onError: (error) => {
          handleFormError(error, form.setError, FIELDS)
          if (error instanceof ApiError && error.fieldErrors.phone && input.phone) {
            setLookingUp(true)
            findByPhone(input.phone)
              .then(setExisting)
              .catch(() => setExisting(null))
              .finally(() => setLookingUp(false))
          }
        },
      },
    )
  })

  return (
    <Dialog open onOpenChange={(open) => !open && !save.isPending && onClose()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New customer</DialogTitle>
          <DialogDescription>Saved to your customer list and selected for this sale.</DialogDescription>
        </DialogHeader>
        <form id="pos-new-customer" onSubmit={onSubmit} noValidate className="grid gap-4 sm:grid-cols-2">
          <FormField label="Name" error={errors.name?.message} className="sm:col-span-2"><Input autoFocus autoComplete="off" {...form.register('name')} /></FormField>
          <FormField label="Phone" error={errors.phone?.message} hint="Used to find the customer next time.">
            <Input type="tel" inputMode="tel" autoComplete="off" {...form.register('phone')} />
          </FormField>
          <FormField label="E-mail (optional)" error={errors.email?.message}><Input type="email" autoComplete="off" {...form.register('email')} /></FormField>
          <FormField label="Address (optional)" error={errors.address?.message} className="sm:col-span-2"><Textarea rows={2} {...form.register('address')} /></FormField>
          {canSetTerms && (
            <FormField label={`Credit limit${currency ? ` (${currency})` : ''}`} error={errors.credit_limit?.message} hint="0 = no credit (due) sales.">
              <Input inputMode="decimal" {...form.register('credit_limit')} />
            </FormField>
          )}
        </form>
        {(lookingUp || existing) && (
          <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
            {lookingUp ? (
              <span>Looking for the customer with this phone…</span>
            ) : existing ? (
              <>
                <span className="min-w-0">
                  This phone belongs to <b>{existing.name}</b> ({existing.code}{existing.phone ? ` · ${existing.phone}` : ''}).
                  {!existing.is_active && ' This customer is inactive — ask a manager to reactivate them.'}
                </span>
                {existing.is_active && (
                  <Button type="button" size="sm" onClick={() => onSelect(toRef(existing))}>
                    <UserCheckIcon data-icon="inline-start" /> Use this customer
                  </Button>
                )}
              </>
            ) : null}
          </div>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" disabled={save.isPending} onClick={onClose}>Cancel</Button>
          <Button type="submit" form="pos-new-customer" disabled={save.isPending}>
            {save.isPending && <Loader2Icon data-icon="inline-start" className="animate-spin" />}
            Add customer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
