import { useMemo } from 'react'
import { XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { flattenCategoryTree, useCatalogList } from '@/features/catalog/api'
import { ProductSearchAdder } from '@/features/online-catalog/components/ordered-picker'
import type { PromotionScope, PromotionTarget } from '@/features/promotions/api'

type Props = {
  scope: Exclude<PromotionScope, 'order'>
  value: PromotionTarget[]
  onChange: (value: PromotionTarget[]) => void
  disabled?: boolean
  error?: string
}

const NOUN: Record<Props['scope'], { label: string; add: string; hint: string }> = {
  products: { label: 'Products', add: 'Add product', hint: 'Every variant of these products gets the offer.' },
  categories: { label: 'Categories', add: 'Add category', hint: 'Products in these categories and their sub-categories get the offer.' },
  brands: { label: 'Brands', add: 'Add brand', hint: 'Every product of these brands gets the offer.' },
}

/** The products, categories or brands an offer applies to (order does not matter). */
export function TargetPicker({ scope, value, onChange, disabled, error }: Props) {
  const noun = NOUN[scope]
  const categories = useCatalogList('categories', scope === 'categories' && !disabled)
  const brands = useCatalogList('brands', scope === 'brands' && !disabled)
  const options = useMemo<PromotionTarget[]>(() => {
    if (scope === 'categories') return flattenCategoryTree(categories.data ?? []).filter((c) => c.is_active).map((c) => ({ id: c.id, name: c.path }))
    if (scope === 'brands') return (brands.data ?? []).filter((b) => b.is_active).map((b) => ({ id: b.id, name: b.name }))
    return []
  }, [scope, categories.data, brands.data])
  const rest = options.filter((o) => !value.some((v) => v.id === o.id))

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium">{noun.label} <span className="font-normal text-muted-foreground">({value.length})</span></span>
      {value.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label={`Chosen ${noun.label.toLowerCase()}`}>
          {value.map((t) => (
            <li key={t.id} className="flex items-center gap-1 rounded-md border bg-muted/40 py-0.5 pr-0.5 pl-2 text-sm">
              <span className="max-w-64 truncate">{t.name}</span>
              {!disabled && (
                <Button type="button" variant="ghost" size="icon-xs" aria-label={`Remove ${t.name}`} onClick={() => onChange(value.filter((x) => x.id !== t.id))}>
                  <XIcon />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {!disabled &&
        (scope === 'products' ? (
          <ProductSearchAdder label={noun.add} exclude={value.map((v) => v.id)} onPick={(item) => onChange([...value, { id: item.id, name: item.name }])} />
        ) : (
          rest.length > 0 && (
            <Select
              value=""
              onValueChange={(id) => {
                const option = rest.find((o) => o.id === id)
                if (option) onChange([...value, option])
              }}
            >
              <SelectTrigger aria-label={noun.add} className="w-full sm:w-80"><SelectValue placeholder={`${noun.add}…`} /></SelectTrigger>
              <SelectContent>{rest.map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}</SelectContent>
            </Select>
          )
        ))}
      {error ? <p className="text-sm text-destructive">{error}</p> : <p className="text-sm text-muted-foreground">{noun.hint}</p>}
    </div>
  )
}
