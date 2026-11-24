import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useSearchParams } from 'react-router'
import { BarcodeIcon, ChevronLeftIcon, ChevronRightIcon, FileInputIcon, FolderTreeIcon, PrinterIcon, Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { PageHeader } from '@/components/common/page-header'
import { ErrorState, LoadingState } from '@/components/common/state-views'
import { VariantPicker } from '@/components/common/variant-picker'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useAuth, useCan } from '@/features/auth/use-auth'
import { useFetchLabelsMutation, useGenerateBarcodesMutation, useLabelSourceQuery, type LabelSource } from '@/features/labels/api'
import { BARCODE_FORMAT_LABELS, detectBarcodeFormat } from '@/features/labels/barcode/barcode'
import { AddFromCategoryDialog, AddFromDocumentDialog } from '@/features/labels/components/add-dialogs'
import { MAX_PER_ITEM, mergeItems, type LabelItem } from '@/features/labels/items'
import { LabelPage, type PrintLabel } from '@/features/labels/components/label-sheets'
import {
  DEFAULT_FIELDS,
  DEFAULT_TEMPLATE_ID,
  expandLabels,
  FIELD_LABELS,
  LABEL_TEMPLATES,
  MAX_LABELS,
  pageRule,
  paginate,
  TEMPLATE_GROUPS,
  templateById,
  totalLabels,
  type LabelFields,
  type LabelTemplateId,
} from '@/features/labels/templates'

const SETTINGS_KEY = 'pos.labels.settings'

type Settings = { template: LabelTemplateId; fields: LabelFields }

function loadSettings(): Settings {
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Settings>
      return { template: templateById(parsed.template).id, fields: { ...DEFAULT_FIELDS, ...(parsed.fields ?? {}) } }
    }
  } catch {
    // Storage blocked or corrupt: fall back to the defaults.
  }
  return { template: DEFAULT_TEMPLATE_ID, fields: DEFAULT_FIELDS }
}

function saveSettings(settings: Settings) {
  try {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
  } catch {
    // Not remembered; the page still works.
  }
}

/** The label source in the URL: `?variant_ids=a,b`, `?goods_receipt_id=`, `?purchase_order_id=` or `?category_id=`. */
function sourceFromParams(params: URLSearchParams): LabelSource | null {
  const ids = (params.get('variant_ids') ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  if (ids.length) return { variant_ids: ids }
  for (const key of ['goods_receipt_id', 'purchase_order_id', 'category_id'] as const) {
    const value = params.get(key)
    if (value) return { [key]: value } as LabelSource
  }
  return null
}

const itemName = (i: Pick<LabelItem, 'product_name' | 'variant_name'>) => (i.variant_name ? `${i.product_name} — ${i.variant_name}` : i.product_name)

/** Renders every page into the print-only portal, opens the print dialog, then unmounts. */
function LabelPrinter({ pages, children, onDone }: { pages: number; children: ReactNode; onDone: () => void }) {
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      window.print()
      onDone()
    })
    return () => cancelAnimationFrame(frame)
  }, [onDone])

  return createPortal(<div className="print-root" data-pages={pages}>{children}</div>, document.body)
}

export function LabelsPage() {
  const me = useAuth()
  const can = useCan()
  const [params] = useSearchParams()
  const paramsKey = params.toString()
  const source = useMemo(() => sourceFromParams(new URLSearchParams(paramsKey)), [paramsKey])
  const initial = useLabelSourceQuery(source)
  const fetchLabels = useFetchLabelsMutation()
  const generate = useGenerateBarcodesMutation()

  const [items, setItems] = useState<LabelItem[]>([])
  const [shopName, setShopName] = useState<string | null>(null)
  // The URL source whose labels were added (once, even if the query refetches).
  const [adopted, setAdopted] = useState<string | null>(null)
  const [settings, setSettings] = useState<Settings>(loadSettings)
  const [pageIndex, setPageIndex] = useState(0)
  const [adding, setAdding] = useState<'document' | 'category' | null>(null)
  const [confirmGenerate, setConfirmGenerate] = useState(false)
  const [printing, setPrinting] = useState(false)

  // Labels from the URL (receipt, order, product) are added once when they arrive.
  if (initial.data && source && adopted !== paramsKey) {
    setAdopted(paramsKey)
    setItems((list) => mergeItems(list, initial.data.labels))
    if (initial.data.shop?.name) setShopName(initial.data.shop.name)
  }

  const template = templateById(settings.template)
  const total = totalLabels(items)
  const tooMany = total > MAX_LABELS
  const printable = useMemo<PrintLabel[]>(() => expandLabels(items), [items])
  const pages = useMemo(() => paginate(printable, template), [printable, template])
  const shown = Math.min(pageIndex, Math.max(pages.length - 1, 0))
  const missing = [...new Set(items.filter((i) => !i.barcode).map((i) => i.variant_id))]
  const canGenerate = can('products.manage') && missing.length > 0
  const canUseDocuments = can('purchases.view')
  const shop = shopName ?? me.organization?.name ?? ''

  const update = (next: Settings) => {
    setSettings(next)
    saveSettings(next)
  }

  const add = (from: LabelSource, done?: () => void) =>
    fetchLabels.mutate(from, {
      onSuccess: (res) => {
        if (res.shop?.name) setShopName(res.shop.name)
        if (res.labels.length === 0) {
          toast.info('Nothing to add: no products with labels there.')
        } else {
          setItems((list) => mergeItems(list, res.labels))
          toast.success(res.labels.length === 1 ? `Added ${itemName(res.labels[0]!)}.` : `Added ${res.labels.length} items.`)
        }
        done?.()
      },
      onError: (e) => toast.error(e.message),
    })

  const setQuantity = (key: string, value: string) => {
    const n = Math.max(0, Math.min(MAX_PER_ITEM, Math.floor(Number(value) || 0)))
    setItems((list) => list.map((i) => (i.key === key ? { ...i, quantity: n } : i)))
  }

  const runGenerate = () =>
    generate.mutate(missing, {
      onSuccess: (results) => {
        const byVariant = new Map(results.map((r) => [r.variant_id, r.barcode]))
        setItems((list) => list.map((i) => (!i.barcode && byVariant.get(i.variant_id) ? { ...i, barcode: byVariant.get(i.variant_id)!, barcode_format: 'ean13' } : i)))
        const created = results.filter((r) => r.generated).length
        toast.success(created === 1 ? '1 barcode created.' : `${created} barcodes created.`)
        setConfirmGenerate(false)
      },
      onError: (e) => {
        toast.error(e.message)
        setConfirmGenerate(false)
      },
    })

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Print labels"
        description="Barcode, price and shelf labels at true size for label sheets and thermal printers."
        actions={
          <Button disabled={total === 0 || tooMany || printing} onClick={() => setPrinting(true)}>
            <PrinterIcon data-icon="inline-start" /> {total === 0 ? 'Print' : `Print ${total} ${total === 1 ? 'label' : 'labels'}`}
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Items</CardTitle>
            <CardDescription>Search products, or add a whole receipt, order or category.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <VariantPicker value={null} aria-label="Add a product" onChange={(option) => add({ variant_ids: [option.id] })} />
            <div className="flex flex-wrap gap-2">
              {canUseDocuments && (
                <Button variant="outline" size="sm" onClick={() => setAdding('document')}><FileInputIcon data-icon="inline-start" /> From receipt or order</Button>
              )}
              <Button variant="outline" size="sm" onClick={() => setAdding('category')}><FolderTreeIcon data-icon="inline-start" /> From category</Button>
              {canGenerate && (
                <Button variant="outline" size="sm" onClick={() => setConfirmGenerate(true)}>
                  <BarcodeIcon data-icon="inline-start" /> Create barcodes for {missing.length} {missing.length === 1 ? 'item' : 'items'}
                </Button>
              )}
            </div>

            {initial.isFetching && items.length === 0 ? (
              <LoadingState rows={3} label="Loading items" />
            ) : initial.error && items.length === 0 ? (
              <ErrorState error={initial.error} onRetry={() => initial.refetch()} />
            ) : items.length === 0 ? (
              <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">No items yet. Add the products you want labels for.</p>
            ) : (
              <ul className="flex flex-col divide-y rounded-md border" aria-label="Label items">
                {items.map((item) => {
                  const name = itemName(item)
                  return (
                    <li key={item.key} className="flex flex-wrap items-center gap-x-3 gap-y-2 p-2">
                      <div className="min-w-0 flex-1 basis-48">
                        <div className="truncate text-sm font-medium">{name}</div>
                        <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                          <span className="font-mono">{item.sku}</span>
                          {item.barcode ? (
                            <span className="font-mono">{item.barcode} · {BARCODE_FORMAT_LABELS[item.barcode_format ?? detectBarcodeFormat(item.barcode)]}</span>
                          ) : (
                            <Badge variant="warning">No barcode: SKU printed</Badge>
                          )}
                          {item.batch_number && <span>Batch {item.batch_number}{item.expires_on && ` · exp ${item.expires_on}`}</span>}
                        </div>
                      </div>
                      <Input
                        type="number"
                        inputMode="numeric"
                        min={0}
                        max={MAX_PER_ITEM}
                        step={1}
                        className="w-20"
                        aria-label={`Labels for ${name}`}
                        value={item.quantity}
                        onChange={(e) => setQuantity(item.key, e.target.value)}
                      />
                      <Button variant="ghost" size="icon" aria-label={`Remove ${name}`} onClick={() => setItems((list) => list.filter((i) => i.key !== item.key))}>
                        <Trash2Icon />
                      </Button>
                    </li>
                  )
                })}
              </ul>
            )}
            {items.length > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span aria-live="polite">{total} {total === 1 ? 'label' : 'labels'} on {pages.length} {pages.length === 1 ? 'page' : 'pages'}</span>
                <Button variant="ghost" size="sm" onClick={() => setItems([])}>Clear all</Button>
              </div>
            )}
            {tooMany && <p role="alert" className="text-sm text-destructive">At most {MAX_LABELS} labels can be printed at once. Lower the counts or print in parts.</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Label</CardTitle>
            <CardDescription>Your choice is remembered on this device.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="label-template">Label size</Label>
              <Select value={template.id} onValueChange={(v) => { update({ ...settings, template: v as LabelTemplateId }); setPageIndex(0) }}>
                <SelectTrigger id="label-template" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TEMPLATE_GROUPS.map((g) => (
                    <SelectGroup key={g.group}>
                      <SelectLabel>{g.label}</SelectLabel>
                      {LABEL_TEMPLATES.filter((t) => t.group === g.group).map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {template.group === 'roll'
                  ? 'One label per page. In the print dialog pick the label printer and set margins to none.'
                  : 'Print at 100% scale ("Actual size"), margins none.'}
              </p>
            </div>
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-medium">Show on the label</legend>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {(Object.keys(FIELD_LABELS) as (keyof LabelFields)[]).map((field) => (
                  <div key={field} className="flex items-center gap-2">
                    <Checkbox
                      id={`label-field-${field}`}
                      checked={settings.fields[field]}
                      onCheckedChange={(v) => update({ ...settings, fields: { ...settings.fields, [field]: v === true } })}
                    />
                    <Label htmlFor={`label-field-${field}`} className="font-normal">{FIELD_LABELS[field]}</Label>
                  </div>
                ))}
              </div>
            </fieldset>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Preview</CardTitle>
          <CardDescription>True size: what you see is what prints.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {pages.length > 1 && (
            <div className="flex items-center gap-2 text-sm">
              <Button variant="outline" size="icon-sm" aria-label="Previous page" disabled={shown === 0} onClick={() => setPageIndex(shown - 1)}><ChevronLeftIcon /></Button>
              <span aria-live="polite">Page {shown + 1} of {pages.length}</span>
              <Button variant="outline" size="icon-sm" aria-label="Next page" disabled={shown >= pages.length - 1} onClick={() => setPageIndex(shown + 1)}><ChevronRightIcon /></Button>
            </div>
          )}
          <div className="max-w-full overflow-auto rounded-md bg-muted p-3" data-testid="label-preview">
            <div className="w-max shadow-sm">
              <LabelPage
                labels={pages[shown] ?? []}
                template={template}
                fields={settings.fields}
                shopName={shop}
                outline
                ariaLabel={`Preview page ${shown + 1}`}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {adding === 'document' && (
        <AddFromDocumentDialog open onOpenChange={(o) => !o && setAdding(null)} pending={fetchLabels.isPending} onAdd={(s) => add(s, () => setAdding(null))} />
      )}
      {adding === 'category' && (
        <AddFromCategoryDialog open onOpenChange={(o) => !o && setAdding(null)} pending={fetchLabels.isPending} onAdd={(s) => add(s, () => setAdding(null))} />
      )}
      <ConfirmDialog
        open={confirmGenerate}
        onOpenChange={setConfirmGenerate}
        title="Create barcodes?"
        description={`${missing.length} ${missing.length === 1 ? 'product has' : 'products have'} no barcode. Each gets a new in-store EAN-13 (starting with 2), saved on the product. Existing barcodes are kept.`}
        confirmLabel="Create barcodes"
        destructive={false}
        pending={generate.isPending}
        onConfirm={runGenerate}
      />
      {printing && (
        <LabelPrinter pages={pages.length} onDone={() => setPrinting(false)}>
          <style>{`${pageRule(template)} @media print { .label-page { break-after: page; page-break-after: always; } .label-page:last-child { break-after: auto; page-break-after: auto; } }`}</style>
          {pages.map((labels, i) => (
            <LabelPage key={i} labels={labels} template={template} fields={settings.fields} shopName={shop} />
          ))}
        </LabelPrinter>
      )}
    </div>
  )
}
