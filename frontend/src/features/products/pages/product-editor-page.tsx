import { useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { Controller, useFieldArray, useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { ArchiveIcon, ArrowLeftIcon, ImagePlusIcon, Loader2Icon, PlusIcon, Trash2Icon, WandSparklesIcon, XIcon } from 'lucide-react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { FormField } from '@/components/common/form-field'
import { ErrorState, LoadingState } from '@/components/common/state-views'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { flattenCategoryTree, useCatalogList } from '@/features/catalog/api'
import {
  useArchiveProductMutation,
  useProductQuery,
  useRemoveProductImageMutation,
  useSaveProductMutation,
  useUploadProductImageMutation,
  type Product,
} from '@/features/products/api'
import { VariantFields } from '@/features/products/components/variant-fields'
import { generateVariants, productFormSchema, toFormValues, toProductInput, type ProductFormValues } from '@/features/products/product-form'
import { handleFormError } from '@/lib/forms'
import { trimDecimal } from '@/lib/money'

const NONE = '__none__'
const FIELDS = [
  'name', 'description', 'type', 'category_id', 'brand_id', 'unit_id', 'tax_rate_id', 'track_stock',
  'track_batches', 'track_serials', 'max_discount_percent', 'is_active', 'options', 'variants',
] as const

function NullableSelect({ value, onChange, placeholder, options, ariaLabel }: {
  value: string | null
  onChange: (value: string | null) => void
  placeholder: string
  options: { value: string; label: string }[]
  ariaLabel?: string
}) {
  return (
    <Select value={value ?? NONE} onValueChange={(v) => onChange(v === NONE ? null : v)}>
      <SelectTrigger className="w-full" aria-label={ariaLabel}><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>{placeholder}</SelectItem>
        {options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
      </SelectContent>
    </Select>
  )
}

function SwitchRow({ id, label, hint, checked, onChange, disabled }: { id: string; label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border p-3">
      <div>
        <Label htmlFor={id}>{label}</Label>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} disabled={disabled} />
    </div>
  )
}

function ImagesCard({ product }: { product: Product }) {
  const upload = useUploadProductImageMutation(product.id)
  const remove = useRemoveProductImageMutation(product.id)
  const input = useRef<HTMLInputElement>(null)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Images</CardTitle>
        <CardDescription>JPEG, PNG or WebP, up to 2 MB each. The first image is shown in lists and at the till.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-3">
        {product.images.map((image) => (
          <div key={image.id} className="relative">
            <img src={image.url} alt={image.original_name} className="size-24 rounded-md border object-cover" />
            <Button
              type="button"
              variant="secondary"
              size="icon-xs"
              className="absolute top-1 right-1"
              aria-label={`Remove ${image.original_name}`}
              disabled={remove.isPending}
              onClick={() => remove.mutate(image.id, { onError: (e) => toast.error(e.message) })}
            >
              <XIcon />
            </Button>
          </div>
        ))}
        <input
          ref={input}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="sr-only"
          aria-label="Upload image"
          onChange={(e) => {
            const file = e.target.files?.[0]
            e.target.value = ''
            if (file) upload.mutate(file, { onSuccess: () => toast.success('Image added.'), onError: (err) => toast.error(err.message) })
          }}
        />
        <Button type="button" variant="outline" className="size-24 flex-col" disabled={upload.isPending} onClick={() => input.current?.click()}>
          {upload.isPending ? <Loader2Icon className="animate-spin" /> : <ImagePlusIcon />}
          <span className="text-xs">Add image</span>
        </Button>
      </CardContent>
    </Card>
  )
}

function ProductForm({ product }: { product?: Product }) {
  const navigate = useNavigate()
  const save = useSaveProductMutation()
  const archive = useArchiveProductMutation()
  const [confirmArchive, setConfirmArchive] = useState(false)
  const categories = useCatalogList('categories')
  const brands = useCatalogList('brands')
  const units = useCatalogList('units')
  const taxRates = useCatalogList('taxRates')
  const tree = useMemo(() => flattenCategoryTree(categories.data ?? []), [categories.data])

  const form = useForm<ProductFormValues>({ resolver: zodResolver(productFormSchema), defaultValues: toFormValues(product) })
  const { errors, isDirty } = form.formState
  const options = useFieldArray({ control: form.control, name: 'options' })
  const variants = useFieldArray({ control: form.control, name: 'variants' })
  const [type, hasVariants, trackStock] = useWatch({ control: form.control, name: ['type', 'has_variants', 'track_stock'] })

  // Active records, plus whatever the product already references (even if since deactivated).
  const activeOr = <T extends { id: string; is_active: boolean }>(rows: T[] | undefined, current: string | null | undefined) =>
    (rows ?? []).filter((r) => r.is_active || r.id === current)

  const onSubmit = form.handleSubmit((values) =>
    save.mutate(
      { id: product?.id, input: toProductInput(values) },
      {
        onSuccess: (saved) => {
          toast.success(product ? `${saved.name} saved.` : `${saved.name} created.`)
          // Server-assigned SKUs and canonical spellings become the new baseline.
          form.reset(toFormValues(saved))
          if (!product) navigate(`/products/${saved.id}`, { replace: true })
        },
        onError: (error) => handleFormError(error, form.setError, FIELDS, { nested: true }),
      },
    ),
  )

  const regenerate = () => {
    const current = form.getValues()
    form.setValue('variants', generateVariants(current.options, current.variants), { shouldDirty: true })
  }

  return (
    <form onSubmit={onSubmit} noValidate className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button asChild variant="ghost" size="icon" aria-label="Back to products">
            <Link to="/products"><ArrowLeftIcon /></Link>
          </Button>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">{product ? product.name : 'New product'}</h1>
        </div>
        <div className="flex gap-2">
          {product && (
            <Button type="button" variant="outline" onClick={() => setConfirmArchive(true)}>
              <ArchiveIcon data-icon="inline-start" /> Archive
            </Button>
          )}
          <Button type="submit" disabled={save.isPending || (!!product && !isDirty)}>
            {save.isPending && <Loader2Icon data-icon="inline-start" className="animate-spin" />}
            {product ? 'Save changes' : 'Create product'}
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader><CardTitle>Details</CardTitle></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <FormField label="Name" error={errors.name?.message} className="sm:col-span-2">
            <Input autoFocus={!product} {...form.register('name')} />
          </FormField>
          <FormField label="Description" error={errors.description?.message} className="sm:col-span-2">
            <Textarea rows={2} {...form.register('description')} />
          </FormField>
          <FormField label="Type" error={errors.type?.message}>
            <Controller control={form.control} name="type" render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="standard">Goods (stocked)</SelectItem>
                  <SelectItem value="service">Service (not stocked)</SelectItem>
                </SelectContent>
              </Select>
            )} />
          </FormField>
          <FormField label="Unit" error={errors.unit_id?.message}>
            <Controller control={form.control} name="unit_id" render={({ field }) => (
              <Select value={field.value || undefined} onValueChange={field.onChange}>
                <SelectTrigger className="w-full"><SelectValue placeholder="Choose a unit" /></SelectTrigger>
                <SelectContent>
                  {activeOr(units.data, product?.unit?.id).map((u) => <SelectItem key={u.id} value={u.id}>{u.name} ({u.code})</SelectItem>)}
                </SelectContent>
              </Select>
            )} />
          </FormField>
          <FormField label="Category" error={errors.category_id?.message}>
            <Controller control={form.control} name="category_id" render={({ field }) => (
              <NullableSelect value={field.value} onChange={field.onChange} placeholder="Uncategorised"
                options={tree.filter((c) => c.is_active || c.id === product?.category?.id).map((c) => ({ value: c.id, label: c.path }))} />
            )} />
          </FormField>
          <FormField label="Brand" error={errors.brand_id?.message}>
            <Controller control={form.control} name="brand_id" render={({ field }) => (
              <NullableSelect value={field.value} onChange={field.onChange} placeholder="No brand"
                options={activeOr(brands.data, product?.brand?.id).map((b) => ({ value: b.id, label: b.name }))} />
            )} />
          </FormField>
          <FormField label="Tax" error={errors.tax_rate_id?.message}>
            <Controller control={form.control} name="tax_rate_id" render={({ field }) => (
              <NullableSelect value={field.value} onChange={field.onChange} placeholder="Tax exempt"
                options={activeOr(taxRates.data, product?.tax_rate?.id).map((t) => ({ value: t.id, label: `${t.name} (${trimDecimal(t.rate)} %)` }))} />
            )} />
          </FormField>
          <FormField label="Max. item discount (%)" error={errors.max_discount_percent?.message} hint="Leave empty for no product-specific limit.">
            <Input inputMode="decimal" {...form.register('max_discount_percent')} />
          </FormField>
          <Controller control={form.control} name="is_active" render={({ field }) => (
            <SwitchRow id="product-active" label="Active" hint="Inactive products cannot be sold." checked={field.value} onChange={field.onChange} />
          )} />
        </CardContent>
      </Card>

      {type === 'standard' && (
        <Card>
          <CardHeader>
            <CardTitle>Stock tracking</CardTitle>
            <CardDescription>Stock levels, batches and serial numbers are recorded from purchasing onwards.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-3">
            <Controller control={form.control} name="track_stock" render={({ field }) => (
              <SwitchRow id="track-stock" label="Track stock" checked={field.value} onChange={field.onChange} />
            )} />
            <Controller control={form.control} name="track_batches" render={({ field }) => (
              <SwitchRow id="track-batches" label="Batches & expiry" checked={field.value} onChange={field.onChange} disabled={!trackStock} />
            )} />
            <Controller control={form.control} name="track_serials" render={({ field }) => (
              <SwitchRow id="track-serials" label="Serial numbers" checked={field.value} onChange={field.onChange} disabled={!trackStock} />
            )} />
            {errors.track_stock?.message && <p className="text-sm text-destructive sm:col-span-3">{errors.track_stock.message}</p>}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Pricing & variants</CardTitle>
          <CardDescription>Prices are stored exactly as entered. Leave SKU empty to number it automatically.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Controller control={form.control} name="has_variants" render={({ field }) => (
            <SwitchRow id="has-variants" label="This product has variants" hint="Sizes, colours, pack sizes… each with its own SKU, price and barcodes."
              checked={field.value}
              onChange={(v) => {
                field.onChange(v)
                if (!v) form.setValue('variants', form.getValues('variants').slice(0, 1).map((row) => ({ ...row, option_values: {} })))
                if (v && form.getValues('options').length === 0) options.append({ name: '', values: '' })
              }} />
          )} />

          {hasVariants && (
            <div className="flex flex-col gap-3 rounded-md border p-3">
              {options.fields.map((option, i) => (
                <div key={option.id} className="grid gap-2 sm:grid-cols-[12rem_1fr_auto] sm:items-start">
                  <FormField label={`Option ${i + 1}`} error={errors.options?.[i]?.name?.message}>
                    <Input placeholder="e.g. Size" {...form.register(`options.${i}.name`)} />
                  </FormField>
                  <FormField label="Values" error={errors.options?.[i]?.values?.message} hint="Comma separated, e.g. S, M, L">
                    <Input {...form.register(`options.${i}.values`)} />
                  </FormField>
                  <Button type="button" variant="ghost" size="icon" className="sm:mt-6" aria-label={`Remove option ${i + 1}`} onClick={() => options.remove(i)}>
                    <Trash2Icon />
                  </Button>
                </div>
              ))}
              {errors.options?.message && <p className="text-sm text-destructive">{errors.options.message}</p>}
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" size="sm" disabled={options.fields.length >= 3} onClick={() => options.append({ name: '', values: '' })}>
                  <PlusIcon data-icon="inline-start" /> Add option
                </Button>
                <Button type="button" size="sm" onClick={regenerate}>
                  <WandSparklesIcon data-icon="inline-start" /> Generate variants
                </Button>
              </div>
            </div>
          )}

          <div className="overflow-x-auto">
            <div className="grid min-w-4xl grid-cols-[10rem_repeat(5,minmax(0,1fr))_minmax(0,1.6fr)_3rem_2.5rem] items-start gap-2 text-xs font-medium text-muted-foreground">
              <span>{hasVariants ? 'Variant' : ''}</span>
              <span>SKU</span><span>Cost</span><span>Selling</span><span>Wholesale</span><span>Reorder at</span><span>Barcodes</span><span>Active</span><span />
            </div>
            {variants.fields.slice(0, hasVariants ? undefined : 1).map((variant, i) => (
              <div key={variant.id} className="grid min-w-4xl grid-cols-[10rem_repeat(5,minmax(0,1fr))_minmax(0,1.6fr)_3rem_2.5rem] items-start gap-2 border-t py-2">
                <span className="self-center truncate text-sm font-medium">
                  {hasVariants ? Object.values(form.getValues(`variants.${i}.option_values`)).join(' / ') || '—' : 'Default'}
                </span>
                <VariantFields index={i} register={form.register} control={form.control} errors={errors} />
                {hasVariants && variants.fields.length > 1 ? (
                  <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove variant ${i + 1}`} onClick={() => variants.remove(i)}><Trash2Icon /></Button>
                ) : <span />}
              </div>
            ))}
            {(errors.variants?.message || errors.variants?.root?.message) && (
              <p className="text-sm text-destructive">{errors.variants?.message ?? errors.variants?.root?.message}</p>
            )}
          </div>
        </CardContent>
      </Card>

      {product && <ImagesCard product={product} />}

      {product && (
        <ConfirmDialog
          open={confirmArchive}
          onOpenChange={setConfirmArchive}
          title={`Archive ${product.name}?`}
          description="It disappears from the catalogue and the till, but stays on past documents. You can restore it from the archived list."
          confirmLabel="Archive"
          pending={archive.isPending}
          onConfirm={() =>
            archive.mutate(product.id, {
              onSuccess: () => {
                toast.success(`${product.name} archived.`)
                navigate('/products', { replace: true })
              },
              onError: (e) => toast.error(e.message),
            })
          }
        />
      )}
    </form>
  )
}

export function ProductEditorPage() {
  const { productId } = useParams()
  const { data, error, isPending, refetch } = useProductQuery(productId)

  if (!productId) return <ProductForm key="new" />
  if (isPending) return <LoadingState rows={8} label="Loading product" />
  if (error) return <ErrorState error={error} onRetry={() => refetch()} />

  // Remount per product so the form's defaults always belong to the product shown.
  return <ProductForm key={data.id} product={data} />
}
