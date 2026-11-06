import { Controller, useFieldArray, type Control, type FieldErrors, type UseFormRegister } from 'react-hook-form'
import { PlusIcon, Trash2Icon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { OptionalSupplierSelect } from '@/features/procurement/components/supplier-pickers'
import { ALLOCATION_LABELS, CHARGE_TYPES, type ChargeAllocation, type ChargeType } from '@/features/landed-cost/allocation'
import { chargeError, DESCRIPTION_MAX, emptyCharge, type ChargesForm } from '@/features/landed-cost/charges'

type Props<T extends ChargesForm> = {
  control: Control<T>
  register: UseFormRegister<T>
  errors: FieldErrors<T>
  /** Receipt charges may be billed by another supplier; voucher charges are billed by the voucher's supplier. */
  billedBy?: boolean
  /** Rows may all be removed (receipt charges are optional). */
  optional?: boolean
}

function FieldError({ message }: { message: string | undefined }) {
  return message ? <p className="mt-1 text-xs text-destructive">{message}</p> : null
}

/** Editable charge rows: type, description, amount, recoverable tax, allocation basis (and who bills it). */
export function ChargesEditor<T extends ChargesForm>({ control, register, errors, billedBy = false, optional = false }: Props<T>) {
  // Only the `charges` part of the parent form is touched.
  const c = control as unknown as Control<ChargesForm>
  const reg = register as unknown as UseFormRegister<ChargesForm>
  const errs = (errors as FieldErrors<ChargesForm>).charges
  const { fields, append, remove } = useFieldArray({ control: c, name: 'charges' })
  const columns = billedBy ? 'lg:grid-cols-[8rem_minmax(8rem,1fr)_7rem_7rem_9rem_11rem_2.25rem]' : 'lg:grid-cols-[8rem_minmax(8rem,1fr)_7rem_7rem_9rem_2.25rem]'

  return (
    <div className="flex flex-col gap-3">
      {fields.length > 0 && (
        <div aria-hidden className={`hidden gap-2 text-xs font-medium text-muted-foreground lg:grid ${columns}`}>
          <span>Type</span><span>Description</span><span>Amount</span><span>Tax</span><span>Allocate</span>{billedBy && <span>Billed by</span>}<span />
        </div>
      )}
      {fields.length > 0 && (
        <ul className="flex flex-col gap-3" aria-label="Charges">
          {fields.map((field, i) => {
            const n = i + 1
            const err = (f: string) => chargeError(errs, i, f)
            return (
              <li key={field.id} aria-label={`Charge ${n}`} className={`grid gap-2 rounded-md border p-3 sm:grid-cols-2 ${columns} lg:items-start lg:border-0 lg:p-0`}>
                <div>
                  <Controller
                    control={c}
                    name={`charges.${i}.type`}
                    render={({ field: f }) => (
                      <Select value={f.value} onValueChange={(v) => f.onChange(v as ChargeType)}>
                        <SelectTrigger className="w-full" aria-label={`Type of charge ${n}`}><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {(Object.entries(CHARGE_TYPES) as [ChargeType, string][]).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    )}
                  />
                </div>
                <div>
                  <Input aria-label={`Description of charge ${n}`} placeholder="Description (optional)" maxLength={DESCRIPTION_MAX} aria-invalid={!!err('description') || undefined} {...reg(`charges.${i}.description`)} />
                  <FieldError message={err('description')} />
                </div>
                <div>
                  <Input aria-label={`Amount of charge ${n}`} inputMode="decimal" placeholder="Amount" aria-invalid={!!err('amount') || undefined} {...reg(`charges.${i}.amount`)} />
                  <FieldError message={err('amount')} />
                </div>
                <div>
                  <Input aria-label={`Tax on charge ${n}`} inputMode="decimal" placeholder="Tax (opt.)" title="Recoverable VAT on the charge — not added to stock cost" aria-invalid={!!err('tax_amount') || undefined} {...reg(`charges.${i}.tax_amount`)} />
                  <FieldError message={err('tax_amount')} />
                </div>
                <div>
                  <Controller
                    control={c}
                    name={`charges.${i}.allocation`}
                    render={({ field: f }) => (
                      <Select value={f.value} onValueChange={(v) => f.onChange(v as ChargeAllocation)}>
                        <SelectTrigger className="w-full" aria-label={`Allocation of charge ${n}`}><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {(Object.entries(ALLOCATION_LABELS) as [ChargeAllocation, string][]).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    )}
                  />
                </div>
                {billedBy && (
                  <div>
                    <Controller
                      control={c}
                      name={`charges.${i}.charge_supplier_id`}
                      render={({ field: f }) => <OptionalSupplierSelect value={f.value} onChange={(s) => f.onChange(s?.id ?? null)} label={`Billed by (charge ${n})`} noneLabel="This invoice" />}
                    />
                    <FieldError message={err('charge_supplier_id')} />
                  </div>
                )}
                <Button type="button" variant="ghost" size="icon-sm" className="justify-self-end lg:mt-1" aria-label={`Remove charge ${n}`} disabled={!optional && fields.length === 1} onClick={() => remove(i)}>
                  <Trash2Icon />
                </Button>
              </li>
            )
          })}
        </ul>
      )}
      {typeof (errs as { message?: string } | undefined)?.message === 'string' && <p className="text-sm text-destructive">{(errs as { message?: string }).message}</p>}
      <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => append(emptyCharge(fields.length === 0 ? 'freight' : 'other'))}>
        <PlusIcon data-icon="inline-start" /> Add charge
      </Button>
    </div>
  )
}
