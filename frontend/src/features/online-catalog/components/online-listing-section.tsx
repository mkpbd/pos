import { useId } from 'react'
import { Controller, useFieldArray, useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { ArrowDownIcon, ArrowUpIcon, ExternalLinkIcon, Loader2Icon, PlusIcon, Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { FormField } from '@/components/common/form-field'
import { ErrorState, LoadingState } from '@/components/common/state-views'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { useCan } from '@/features/auth/use-auth'
import { RichTextEditor } from '@/features/content/components/rich-text-editor'
import { useProductListingQuery, useSaveProductListingMutation, type ProductListingResponse } from '@/features/online-catalog/api'
import { ProductPicker } from '@/features/online-catalog/components/ordered-picker'
import {
  applyListingError,
  counter,
  LISTING_STATE,
  listingFormSchema,
  PRODUCT_NAME_MAX,
  MAX_RELATED,
  MAX_SPECIFICATIONS,
  SEO_DESCRIPTION_MAX,
  SEO_TITLE_MAX,
  SHORT_DESCRIPTION_MAX,
  toListingFormValues,
  toListingInput,
  type ListingFormValues,
} from '@/features/online-catalog/listing-form'
import { BanglaTranslations } from '@/features/translations/components/bangla-translations'
import { rhfBnErrors } from '@/features/translations/translations'
import { formatMoney } from '@/lib/money'

const NO_IMAGE = '__none__'

function SwitchRow({ id, label, hint, checked, onChange, disabled, error }: { id: string; label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; error?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-3 rounded-md border p-3">
        <div>
          <Label htmlFor={id}>{label}</Label>
          {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
        </div>
        <Switch id={id} checked={checked} onCheckedChange={onChange} disabled={disabled} aria-invalid={error ? true : undefined} />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  )
}

function Heading({ children }: { children: string }) {
  return <h3 className="text-sm font-semibold tracking-tight">{children}</h3>
}

function ListingForm({ productId, data, canManage }: { productId: string; data: ProductListingResponse; canManage: boolean }) {
  const save = useSaveProductListingMutation(productId)
  const ids = useId()
  const form = useForm<ListingFormValues>({ resolver: zodResolver(listingFormSchema), defaultValues: toListingFormValues(data) })
  const { errors, isDirty } = form.formState
  const specs = useFieldArray({ control: form.control, name: 'specifications' })
  const [slug, shortDescription, seoTitle, seoDescription, isPublished, descriptionHtml] = useWatch({
    control: form.control,
    name: ['slug', 'short_description', 'seo_title', 'seo_description', 'is_published', 'description_html'],
  })
  const { product, listing } = data
  const state = LISTING_STATE[listing.state]
  const variantIds = product.variants.map((v) => v.id)
  const disabled = !canManage

  const onSubmit = form.handleSubmit((values) =>
    save.mutate(toListingInput(values, { bn: form.formState.defaultValues?.translations?.bn }), {
      onSuccess: (saved) => {
        toast.success('Online listing saved.')
        // The server's slug and state become the new baseline; related lists were saved as shown.
        form.reset({ ...toListingFormValues(saved), related: values.related, frequently_bought: values.frequently_bought })
      },
      onError: (error) => applyListingError(error, form.setError, variantIds),
    }),
  )

  return (
    <Card id="online-store" aria-labelledby={`${ids}-title`}>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1.5">
          <CardTitle id={`${ids}-title`} className="flex flex-wrap items-center gap-2">
            Online store <Badge variant={state.variant}>{state.label}</Badge>
          </CardTitle>
          <CardDescription>How this product appears in your web shop. Prices and stock come from the product itself.</CardDescription>
        </div>
        {listing.state === 'live' && (
          <Button asChild variant="outline" size="sm">
            <a href={data.url} target="_blank" rel="noreferrer"><ExternalLinkIcon data-icon="inline-start" /> View on store</a>
          </Button>
        )}
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-6" aria-label="Online listing">
          <fieldset disabled={disabled} className="flex min-w-0 flex-col gap-6">
            <section className="flex flex-col gap-3">
              <Heading>Publishing</Heading>
              {!product.is_active && <p className="text-sm text-muted-foreground">This product is inactive, so it cannot be published until it is activated again.</p>}
              <div className="grid gap-3 sm:grid-cols-2">
                <Controller control={form.control} name="is_published" render={({ field }) => (
                  <SwitchRow id={`${ids}-published`} label="Published" hint="Shown in the shop (within the schedule below)." checked={field.value} onChange={field.onChange} disabled={disabled} error={errors.is_published?.message} />
                )} />
                <Controller control={form.control} name="is_featured" render={({ field }) => (
                  <SwitchRow id={`${ids}-featured`} label="Featured" hint="Listed first and in featured sections." checked={field.value} onChange={field.onChange} disabled={disabled} />
                )} />
              </div>
              {isPublished && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <FormField label="Publish from" error={errors.published_at?.message} hint="Empty: right away.">
                    <Input type="datetime-local" {...form.register('published_at')} />
                  </FormField>
                  <FormField label="Unpublish at" error={errors.unpublished_at?.message} hint="Empty: stays online.">
                    <Input type="datetime-local" {...form.register('unpublished_at')} />
                  </FormField>
                </div>
              )}
              <div className="grid gap-3 sm:grid-cols-2">
                <FormField label="Show as new until" error={errors.is_new_until?.message} hint="Adds a “New” badge until this day.">
                  <Input type="date" {...form.register('is_new_until')} />
                </FormField>
                <FormField label="Sort weight" error={errors.sort_weight?.message} hint="Higher numbers come first in the default sort.">
                  <Input inputMode="numeric" {...form.register('sort_weight')} />
                </FormField>
              </div>
            </section>

            <section className="flex flex-col gap-3">
              <Heading>Web address & text</Heading>
              <FormField
                label="Web address"
                error={errors.slug?.message}
                hint={<>Shown at <span className="font-mono break-all">/product/{slug || listing.slug || 'your-address'}</span>. Leave empty to use the product name.</>}
              >
                <Input maxLength={120} spellCheck={false} autoCapitalize="none" {...form.register('slug', { setValueAs: (v: string) => v.trim().toLowerCase() })} />
              </FormField>
              <FormField label="Short description" error={errors.short_description?.message} hint={`Shown next to the price and on product cards. ${counter(shortDescription, SHORT_DESCRIPTION_MAX)}`}>
                <Textarea rows={2} maxLength={SHORT_DESCRIPTION_MAX} {...form.register('short_description')} />
              </FormField>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`${ids}-description`}>Web description</Label>
                <Controller control={form.control} name="description_html" render={({ field }) => (
                  <RichTextEditor id={`${ids}-description`} label="Web description" value={field.value} onChange={field.onChange} invalid={!!errors.description_html} disabled={disabled} />
                )} />
                {errors.description_html?.message && <p className="text-sm text-destructive">{errors.description_html.message}</p>}
              </div>
            </section>

            <section className="flex flex-col gap-3">
              <Heading>Specifications</Heading>
              {specs.fields.length === 0 && <p className="text-sm text-muted-foreground">No specifications. Add rows such as “Material: Cotton”.</p>}
              {specs.fields.length > 0 && (
                <ol className="flex flex-col gap-2" aria-label="Specifications">
                  {specs.fields.map((row, i) => (
                    <li key={row.id} className="grid gap-2 rounded-md border p-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto] sm:items-start">
                      <div className="flex flex-col gap-1">
                        <Input aria-label={`Specification ${i + 1} label`} placeholder="Label" maxLength={60} aria-invalid={errors.specifications?.[i]?.label ? true : undefined} {...form.register(`specifications.${i}.label`)} />
                        {errors.specifications?.[i]?.label?.message && <p className="text-sm text-destructive">{errors.specifications[i]?.label?.message}</p>}
                      </div>
                      <div className="flex flex-col gap-1">
                        <Input aria-label={`Specification ${i + 1} value`} placeholder="Value" maxLength={200} aria-invalid={errors.specifications?.[i]?.value ? true : undefined} {...form.register(`specifications.${i}.value`)} />
                        {errors.specifications?.[i]?.value?.message && <p className="text-sm text-destructive">{errors.specifications[i]?.value?.message}</p>}
                      </div>
                      {canManage && (
                        <div className="flex">
                          <Button type="button" variant="ghost" size="icon-sm" aria-label={`Move specification ${i + 1} up`} disabled={i === 0} onClick={() => specs.move(i, i - 1)}><ArrowUpIcon /></Button>
                          <Button type="button" variant="ghost" size="icon-sm" aria-label={`Move specification ${i + 1} down`} disabled={i === specs.fields.length - 1} onClick={() => specs.move(i, i + 1)}><ArrowDownIcon /></Button>
                          <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove specification ${i + 1}`} onClick={() => specs.remove(i)}><Trash2Icon /></Button>
                        </div>
                      )}
                    </li>
                  ))}
                </ol>
              )}
              {errors.specifications?.message && <p className="text-sm text-destructive">{errors.specifications.message}</p>}
              {canManage && specs.fields.length < MAX_SPECIFICATIONS && (
                <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => specs.append({ label: '', value: '' })}>
                  <PlusIcon data-icon="inline-start" /> Add specification
                </Button>
              )}
            </section>

            <section className="flex flex-col gap-3">
              <Heading>Variants on the web</Heading>
              <p className="text-sm text-muted-foreground">A compare-at price above the selling price shows the item as on sale. Pick the image shown when a variant is chosen.</p>
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full min-w-[34rem] text-sm">
                  <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 font-medium">Variant</th>
                      <th className="px-3 py-2 font-medium">Selling price</th>
                      <th className="px-3 py-2 font-medium">Compare-at price</th>
                      <th className="px-3 py-2 font-medium">Image</th>
                    </tr>
                  </thead>
                  <tbody>
                    {product.variants.map((v, i) => {
                      const name = [v.name || Object.values(v.option_values).join(' / ') || null, v.sku].filter(Boolean).join(' · ')
                      const error = errors.variants?.[i]?.compare_at_price?.message ?? errors.variants?.[i]?.image_id?.message
                      return (
                        <tr key={v.id} className="border-t align-top">
                          <td className="px-3 py-2">
                            <span className="block font-medium">{v.name || Object.values(v.option_values).join(' / ') || 'Default'}</span>
                            <span className="block font-mono text-xs text-muted-foreground">{v.sku}{v.is_active ? '' : ' · inactive'}</span>
                          </td>
                          <td className="px-3 py-2 tabular-nums">{formatMoney(v.selling_price)}</td>
                          <td className="px-3 py-2">
                            <Input
                              className="w-32"
                              inputMode="decimal"
                              aria-label={`Compare-at price for ${name}`}
                              aria-invalid={errors.variants?.[i]?.compare_at_price ? true : undefined}
                              {...form.register(`variants.${i}.compare_at_price`)}
                            />
                            {error && <p className="mt-1 text-sm text-destructive">{error}</p>}
                          </td>
                          <td className="px-3 py-2">
                            <Controller control={form.control} name={`variants.${i}.image_id`} render={({ field }) => (
                              <Select value={field.value ?? NO_IMAGE} onValueChange={(id) => field.onChange(id === NO_IMAGE ? null : id)} disabled={disabled || product.images.length === 0}>
                                <SelectTrigger aria-label={`Image for ${name}`} className="w-40"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value={NO_IMAGE}>Product images</SelectItem>
                                  {product.images.map((img, n) => (
                                    <SelectItem key={img.id} value={img.id}>
                                      <img src={img.url} alt="" className="size-6 rounded object-cover" /> Image {n + 1}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            )} />
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="grid gap-6 md:grid-cols-2">
              <Controller control={form.control} name="related" render={({ field }) => (
                <ProductPicker
                  label="Related products"
                  addLabel="Add related product"
                  value={field.value}
                  onChange={field.onChange}
                  max={MAX_RELATED}
                  excludeIds={[productId]}
                  disabled={disabled}
                  hint={`Up to ${MAX_RELATED}. Empty: other products of the same category are shown.`}
                  error={errors.related?.message}
                />
              )} />
              <Controller control={form.control} name="frequently_bought" render={({ field }) => (
                <ProductPicker
                  label="Frequently bought together"
                  addLabel="Add product bought together"
                  value={field.value}
                  onChange={field.onChange}
                  max={MAX_RELATED}
                  excludeIds={[productId]}
                  disabled={disabled}
                  hint={`Up to ${MAX_RELATED}. Empty: the section is hidden.`}
                  error={errors.frequently_bought?.message}
                />
              )} />
            </section>

            <section className="flex flex-col gap-3">
              <Heading>Search engines</Heading>
              <FormField label="SEO title" error={errors.seo_title?.message} hint={`${counter(seoTitle, SEO_TITLE_MAX)} · empty: the product name.`}>
                <Input maxLength={SEO_TITLE_MAX} {...form.register('seo_title')} />
              </FormField>
              <FormField label="Meta description" error={errors.seo_description?.message} hint={`${counter(seoDescription, SEO_DESCRIPTION_MAX)} · empty: the short description.`}>
                <Textarea rows={2} maxLength={SEO_DESCRIPTION_MAX} {...form.register('seo_description')} />
              </FormField>
            </section>

            <Controller control={form.control} name="translations.bn" render={({ field }) => (
              <BanglaTranslations
                fields={[
                  { name: 'name', label: 'Product name', base: product.name, max: PRODUCT_NAME_MAX },
                  { name: 'short_description', label: 'Short description', base: shortDescription, kind: 'textarea', max: SHORT_DESCRIPTION_MAX },
                  { name: 'description_html', label: 'Web description', base: descriptionHtml, kind: 'rich' },
                  { name: 'seo_title', label: 'SEO title', base: seoTitle, max: SEO_TITLE_MAX },
                  { name: 'seo_description', label: 'Meta description', base: seoDescription, kind: 'textarea', max: SEO_DESCRIPTION_MAX },
                ]}
                value={field.value}
                onChange={field.onChange}
                errors={rhfBnErrors(errors.translations)}
                disabled={disabled}
              />
            )} />
          </fieldset>

          {canManage && (
            <div className="flex flex-wrap items-center justify-end gap-3 border-t pt-4">
              {isDirty && <span className="text-sm text-muted-foreground">Unsaved changes</span>}
              <Button type="submit" disabled={save.isPending || (listing.exists && !isDirty)}>
                {save.isPending && <Loader2Icon data-icon="inline-start" className="animate-spin" />}
                Save online listing
              </Button>
            </div>
          )}
        </form>
      </CardContent>
    </Card>
  )
}

/** The product's web listing: shown to online_catalog.view, editable with online_catalog.manage. */
export function OnlineListingSection({ productId }: { productId: string }) {
  const can = useCan()
  const query = useProductListingQuery(productId)

  if (query.isPending) return <LoadingState rows={4} label="Loading online listing" />
  if (query.error) return <ErrorState error={query.error} onRetry={() => query.refetch()} />

  // Remount when the product's variants or images change so rows always match the product.
  const shapeKey = `${query.data.product.variants.map((v) => `${v.id}:${v.selling_price}`).join(',')}|${query.data.product.images.map((i) => i.id).join(',')}`
  return <ListingForm key={shapeKey} productId={productId} data={query.data} canManage={can('online_catalog.manage')} />
}
