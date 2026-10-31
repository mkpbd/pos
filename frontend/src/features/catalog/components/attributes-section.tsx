import { useState } from 'react'
import { Controller, useFieldArray, useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { ArrowDownIcon, ArrowUpIcon, Loader2Icon, PencilIcon, PlusIcon, Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { FormField } from '@/components/common/form-field'
import { EmptyState, ErrorState, LoadingState } from '@/components/common/state-views'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { attributeFormSchema, HEX_PATTERN, MAX_ATTRIBUTE_VALUES, toAttributeFormValues, toAttributeInput, type AttributeFormValues } from '@/features/catalog/attribute-form'
import { useAttributesQuery, useDeleteAttributeMutation, useSaveAttributeMutation, type Attribute, type AttributeDisplay } from '@/features/catalog/api'
import { handleFormError } from '@/lib/forms'

const DISPLAY_LABELS: Record<AttributeDisplay, string> = {
  button: 'Buttons',
  swatch: 'Colour swatches',
  text: 'Drop-down list',
}

const FIELDS = ['name', 'slug', 'display', 'is_filterable', 'values'] as const

function AttributeForm({ attribute, onDone }: { attribute: Attribute | null; onDone: () => void }) {
  const save = useSaveAttributeMutation()
  const form = useForm<AttributeFormValues>({ resolver: zodResolver(attributeFormSchema), defaultValues: toAttributeFormValues(attribute) })
  const { errors } = form.formState
  const values = useFieldArray({ control: form.control, name: 'values' })
  const display = useWatch({ control: form.control, name: 'display' })

  const submit = form.handleSubmit((v) =>
    save.mutate(
      { id: attribute?.id, input: toAttributeInput(v) },
      {
        onSuccess: (saved) => {
          toast.success(`${saved.name} saved.`)
          onDone()
        },
        onError: (error) => handleFormError(error, form.setError, FIELDS, { nested: true }),
      },
    ),
  )

  return (
    <>
      <DialogHeader>
        <DialogTitle>{attribute ? `Edit ${attribute.name}` : 'New attribute'}</DialogTitle>
        <DialogDescription>Product options with this name (any capitalisation) use these values for web filters and the variant selector.</DialogDescription>
      </DialogHeader>
      <form id="attribute-form" noValidate onSubmit={submit} className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Name" error={errors.name?.message} hint="E.g. Size, Colour, Pack.">
            <Input maxLength={60} {...form.register('name')} />
          </FormField>
          <FormField label="Filter address" error={errors.slug?.message} hint="Used in filter links. Empty: from the name.">
            <Input maxLength={80} spellCheck={false} autoCapitalize="none" {...form.register('slug', { setValueAs: (v: string) => v.trim().toLowerCase() })} />
          </FormField>
          <FormField label="Shown as" error={errors.display?.message}>
            <Controller control={form.control} name="display" render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger className="w-full" aria-label="Shown as"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(DISPLAY_LABELS) as AttributeDisplay[]).map((d) => <SelectItem key={d} value={d}>{DISPLAY_LABELS[d]}</SelectItem>)}
                </SelectContent>
              </Select>
            )} />
          </FormField>
          <Controller control={form.control} name="is_filterable" render={({ field }) => (
            <div className="flex items-center justify-between gap-3 rounded-md border p-3 sm:mt-6">
              <div>
                <Label htmlFor="attribute-filterable">Filter in the shop</Label>
                <p className="text-xs text-muted-foreground">Offered as a filter on listing pages.</p>
              </div>
              <Switch id="attribute-filterable" checked={field.value} onCheckedChange={field.onChange} />
            </div>
          )} />
        </div>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-sm font-medium">Values, in display order</legend>
          {values.fields.length === 0 && <p className="text-sm text-muted-foreground">No values yet.</p>}
          {values.fields.map((row, i) => {
            const error = errors.values?.[i]?.value?.message ?? errors.values?.[i]?.swatch_hex?.message
            return (
              <div key={row.id} className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  {display === 'swatch' && (
                    <Controller control={form.control} name={`values.${i}.swatch_hex`} render={({ field }) => (
                      <input
                        type="color"
                        aria-label={`Value ${i + 1} colour`}
                        value={HEX_PATTERN.test(field.value) ? field.value.toLowerCase() : '#000000'}
                        onChange={(e) => field.onChange(e.target.value)}
                        className="h-9 w-11 shrink-0 cursor-pointer rounded-md border bg-transparent p-1"
                      />
                    )} />
                  )}
                  <Input aria-label={`Value ${i + 1}`} placeholder="Value" maxLength={60} aria-invalid={error ? true : undefined} className="min-w-0 flex-1" {...form.register(`values.${i}.value`)} />
                  <Button type="button" variant="ghost" size="icon-sm" aria-label={`Move value ${i + 1} up`} disabled={i === 0} onClick={() => values.move(i, i - 1)}><ArrowUpIcon /></Button>
                  <Button type="button" variant="ghost" size="icon-sm" aria-label={`Move value ${i + 1} down`} disabled={i === values.fields.length - 1} onClick={() => values.move(i, i + 1)}><ArrowDownIcon /></Button>
                  <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove value ${i + 1}`} onClick={() => values.remove(i)}><Trash2Icon /></Button>
                </div>
                {error && <p className="text-sm text-destructive">{error}</p>}
              </div>
            )
          })}
          {(errors.values?.message ?? errors.values?.root?.message) && <p className="text-sm text-destructive">{errors.values?.message ?? errors.values?.root?.message}</p>}
          {values.fields.length < MAX_ATTRIBUTE_VALUES && (
            <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => values.append({ value: '', swatch_hex: display === 'swatch' ? '#000000' : '' })}>
              <PlusIcon data-icon="inline-start" /> Add value
            </Button>
          )}
        </fieldset>
      </form>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>Cancel</Button>
        <Button type="submit" form="attribute-form" disabled={save.isPending}>
          {save.isPending && <Loader2Icon data-icon="inline-start" className="animate-spin" />}
          {attribute ? 'Save changes' : 'Create attribute'}
        </Button>
      </DialogFooter>
    </>
  )
}

function ValuePreview({ attribute }: { attribute: Attribute }) {
  const shown = attribute.values.slice(0, 8)
  if (shown.length === 0) return <span className="text-muted-foreground">—</span>
  return (
    <span className="flex flex-wrap items-center gap-1">
      {shown.map((v) => (
        <Badge key={v.id} variant="outline">
          {attribute.display === 'swatch' && v.swatch_hex && <span className="size-3 rounded-full border" style={{ backgroundColor: v.swatch_hex }} aria-hidden />}
          {v.value}
        </Badge>
      ))}
      {attribute.values.length > shown.length && <span className="text-xs text-muted-foreground">+{attribute.values.length - shown.length}</span>}
    </span>
  )
}

/** Catalog settings tab: the attribute dictionary (attributes.manage). */
export function AttributesSection() {
  const attributes = useAttributesQuery()
  const remove = useDeleteAttributeMutation()
  const [editing, setEditing] = useState<Attribute | null | undefined>(undefined)
  const [deleting, setDeleting] = useState<Attribute | null>(null)

  return (
    <div className="flex flex-col gap-4">
      <Button className="self-start" variant="outline" onClick={() => setEditing(null)}>
        <PlusIcon data-icon="inline-start" /> New attribute
      </Button>

      {attributes.isPending ? (
        <LoadingState rows={4} label="Loading attributes" />
      ) : attributes.error ? (
        <ErrorState error={attributes.error} onRetry={() => attributes.refetch()} />
      ) : attributes.data.length === 0 ? (
        <EmptyState title="No attributes yet" description="Add Size, Colour or similar to give the shop filters and colour swatches." />
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead className="hidden md:table-cell">Shown as</TableHead>
                <TableHead>Values</TableHead>
                <TableHead className="hidden sm:table-cell">Filter</TableHead>
                <TableHead className="w-24"><span className="sr-only">Actions</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {attributes.data.map((a) => (
                <TableRow key={a.id}>
                  <TableCell>
                    <span className="font-medium">{a.name}</span>
                    <span className="block font-mono text-xs text-muted-foreground">{a.slug}</span>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">{DISPLAY_LABELS[a.display]}</TableCell>
                  <TableCell><ValuePreview attribute={a} /></TableCell>
                  <TableCell className="hidden sm:table-cell">{a.is_filterable ? <Badge variant="success">Yes</Badge> : <Badge variant="outline">No</Badge>}</TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    <Button variant="ghost" size="icon-sm" aria-label={`Edit ${a.name}`} onClick={() => setEditing(a)}><PencilIcon /></Button>
                    <Button variant="ghost" size="icon-sm" aria-label={`Delete ${a.name}`} onClick={() => setDeleting(a)}><Trash2Icon /></Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={editing !== undefined} onOpenChange={(open) => !open && setEditing(undefined)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
          {editing !== undefined && <AttributeForm key={editing?.id ?? 'new'} attribute={editing} onDone={() => setEditing(undefined)} />}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`Delete ${deleting?.name}?`}
        description="Products keep their options; the shop stops offering this attribute as a filter and shows its values in the products' own order."
        confirmLabel="Delete"
        pending={remove.isPending}
        onConfirm={() =>
          deleting &&
          remove.mutate(deleting.id, {
            onSuccess: () => toast.success(`${deleting.name} deleted.`),
            onError: (e) => toast.error(e.message),
            onSettled: () => setDeleting(null),
          })
        }
      />
    </div>
  )
}
