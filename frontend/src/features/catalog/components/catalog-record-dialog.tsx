import { useEffect } from 'react'
import { Controller, useForm, type FieldValues, type Path, type RegisterOptions } from 'react-hook-form'
import { Loader2Icon } from 'lucide-react'
import { FormField } from '@/components/common/form-field'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { handleFormError } from '@/lib/forms'

const NONE = '__none__'

export type FieldConfig<T extends FieldValues> =
  | { name: Path<T>; label: string; type: 'text'; rules?: RegisterOptions<T>; hint?: string; inputMode?: 'decimal' }
  | { name: Path<T>; label: string; type: 'switch'; hint?: string }
  | { name: Path<T>; label: string; type: 'select'; options: { value: string; label: string }[]; noneLabel?: string; hint?: string }

type Props<T extends FieldValues> = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  fields: FieldConfig<T>[]
  defaultValues: T
  submitLabel: string
  isPending: boolean
  /** Returns a promise that rejects with the API error, so it can be mapped onto fields. */
  onSubmit: (values: T) => Promise<unknown>
}

/**
 * Small create/edit dialog for catalog reference records (brands, units, tax rates, …).
 * Empty select/text values are sent as null so optional fields can be cleared.
 */
export function CatalogRecordDialog<T extends FieldValues>({ open, onOpenChange, title, description, fields, defaultValues, submitLabel, isPending, onSubmit }: Props<T>) {
  const form = useForm<T>({ defaultValues: defaultValues as never })
  const { errors } = form.formState

  useEffect(() => {
    if (open) form.reset(defaultValues as never)
  }, [open, defaultValues, form])

  const submit = form.handleSubmit(async (values) => {
    try {
      await onSubmit(values)
      onOpenChange(false)
    } catch (error) {
      handleFormError(error, form.setError, fields.map((f) => f.name))
    }
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <form id="catalog-record-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
          {fields.map((field) => {
            const error = (errors as Record<string, { message?: string } | undefined>)[field.name]?.message

            if (field.type === 'switch') {
              return (
                <Controller
                  key={field.name}
                  control={form.control}
                  name={field.name}
                  render={({ field: f }) => (
                    <div className="flex items-center justify-between gap-3 rounded-md border p-3">
                      <div>
                        <Label htmlFor={`field-${field.name}`}>{field.label}</Label>
                        {field.hint && <p className="text-xs text-muted-foreground">{field.hint}</p>}
                      </div>
                      <Switch id={`field-${field.name}`} checked={!!f.value} onCheckedChange={f.onChange} />
                    </div>
                  )}
                />
              )
            }

            if (field.type === 'select') {
              return (
                <FormField key={field.name} label={field.label} error={error} hint={field.hint}>
                  <Controller
                    control={form.control}
                    name={field.name}
                    render={({ field: f }) => (
                      <Select value={(f.value as string | null) ?? NONE} onValueChange={(v) => f.onChange(v === NONE ? null : v)}>
                        <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NONE}>{field.noneLabel ?? 'None'}</SelectItem>
                          {field.options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    )}
                  />
                </FormField>
              )
            }

            return (
              <FormField key={field.name} label={field.label} error={error} hint={field.hint}>
                <Input inputMode={field.inputMode} {...form.register(field.name, { ...field.rules, setValueAs: (v: string) => (typeof v === 'string' && v.trim() === '' ? null : typeof v === 'string' ? v.trim() : v) })} />
              </FormField>
            )
          })}
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" form="catalog-record-form" disabled={isPending}>
            {isPending && <Loader2Icon data-icon="inline-start" className="animate-spin" />}
            {submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
