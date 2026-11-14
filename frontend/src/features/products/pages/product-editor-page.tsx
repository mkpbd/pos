import { useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { ArchiveIcon, ArrowLeftIcon, ImagePlusIcon, Loader2Icon, XIcon } from 'lucide-react'
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
import { useCan } from '@/features/auth/use-auth'
import { flattenCategoryTree, useCatalogList } from '@/features/catalog/api'
import { OnlineListingSection } from '@/features/online-catalog/components/online-listing-section'
import {
  useArchiveProductMutation,
  useProductQuery,
  useRemoveProductImageMutation,
  useSaveProductMutation,
  useUploadProductImageMutation,
  type Product,
} from '@/features/products/api'
import { BackInStockCard } from '@/features/products/components/back-in-stock-card'
import { OptionPhotosCard } from '@/features/products/components/option-photos-card'
import { VariantFields } from '@/features/products/components/variant-fields'
import { VariantGrid } from '@/features/products/components/variant-grid'
import { VariantSupplySection } from '@/features/supply-chain/components/variant-supply-section'
import { productFormSchema, toFormValues, toProductInput, type ProductFormValues } from '@/features/products/product-form'
import { handleFormError } from '@/lib/forms'
import { trimDecimal } from '@/lib/money'

const NONE = '__none__'
const FIELDS = [
  'name', 'description', 'type', 'category_id', 'brand_id', 'unit_id', 'tax_rate_id', 'track_stock',
  'track_batches', 'track_serials', 'max_discount_percent', 'is_active', 'variants',
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
  const [type, trackStock] = useWatch({ control: form.control, name: ['type', 'track_stock'] })

  // Active records, plus whatever the product already references (even if since deactivated).
  const activeOr = <T extends { id: string; is_active: boolean }>(rows: T[] | undefined, current: string | null | undefined) =>
    (rows ?? []).filter((r) => r.is_active || r.id === current)

  const onSubmit = form.handleSubmit((values) =>
    save.mutate(
      { id: product?.id, input: toProductInput(values, product) },
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
            {product ? 'Save details' : 'Create product'}
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

      {!product && (
        <Card>
          <CardHeader>
            <CardTitle>Price</CardTitle>
            <CardDescription>
              Prices are stored exactly as entered. Leave SKU empty to number it automatically. Selling in sizes or colours? Create the product
              first, then add its options in the variant grid.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <div className="grid min-w-3xl grid-cols-[repeat(5,minmax(0,1fr))_minmax(0,1.6fr)_3rem] items-start gap-2 text-xs font-medium text-muted-foreground">
                <span>SKU</span><span>Cost</span><span>Selling</span><span>Wholesale</span><span>Reorder at</span><span>Barcodes</span><span>Active</span>
              </div>
              <div className="grid min-w-3xl grid-cols-[repeat(5,minmax(0,1fr))_minmax(0,1.6fr)_3rem] items-start gap-2 border-t py-2">
                <VariantFields index={0} register={form.register} control={form.control} errors={errors} />
              </div>
            </div>
          </CardContent>
        </Card>
      )}

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
  const can = useCan()
  const { data, error, isPending, refetch } = useProductQuery(productId)

  if (!productId) return <ProductForm key="new" />
  if (isPending) return <LoadingState rows={8} label="Loading product" />
  if (error) return <ErrorState error={error} onRetry={() => refetch()} />

  // Remount per product so the form's defaults always belong to the product shown.
  return (
    <div className="flex flex-col gap-6">
      <ProductForm key={data.id} product={data} />
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <VariantGrid key={data.id} product={data} />
        <ImagesCard product={data} />
        {!!data.options?.length && data.images.length > 0 && (
          // Remount when the options or photos change so every value and photo is listed.
          <OptionPhotosCard key={`${JSON.stringify(data.options)}|${data.images.map((i) => i.id).join(',')}`} product={data} />
        )}
        {can('online_catalog.view') && <BackInStockCard productId={data.id} />}
      </div>
      <VariantSupplySection product={data} />
      {can('online_catalog.view') && (
        <div className="mx-auto w-full max-w-5xl">
          <OnlineListingSection productId={data.id} />
        </div>
      )}
    </div>
  )
}
