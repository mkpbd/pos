import { FormField } from '@/components/common/form-field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useCan } from '@/features/auth/use-auth'
import { usePromotionsQuery, type PromotionRow } from '@/features/promotions/api'
import { ACTIVE_PROMOTIONS_PARAMS, HOT_DEALS_LIMIT, isFlashSale, type HotDealsConfig } from '@/features/storefront/hot-deals'

const ALL = 'all'
const range = (min: number, max: number) => Array.from({ length: max - min + 1 }, (_, i) => min + i)

/** Active flash sales for the picker and the row summary; only fetched for staff who may see promotions. */
export function useFlashSales(): { items: PromotionRow[]; allowed: boolean; isPending: boolean; error: Error | null } {
  const can = useCan()
  const allowed = can('promotions.view')
  const query = usePromotionsQuery(ACTIVE_PROMOTIONS_PARAMS, allowed)
  return { items: (query.data?.items ?? []).filter(isFlashSale), allowed, isPending: allowed && query.isPending, error: query.error }
}

/** Config of the `hot_deals` homepage section. */
export function HotDealsFields({ config, onChange, errors }: { config: HotDealsConfig; onChange: (config: HotDealsConfig) => void; errors: Record<string, string> }) {
  const flash = useFlashSales()
  const current = config.promotion_id
  const missing = current !== null && !flash.isPending && !flash.items.some((p) => p.id === current)

  let hint = 'Every live flash sale, soonest ending first. The section hides itself when none is live.'
  if (!flash.allowed) hint = 'Choosing a single promotion needs access to Promotions; “All flash sales” always works.'
  else if (flash.error) hint = 'Promotions could not be loaded; “All flash sales” always works.'
  else if (!flash.isPending && flash.items.length === 0) hint = 'No flash sale is active right now. Under Promotions, create an automatic product, category or brand offer with an end time and switch on its countdown.'
  else if (current) hint = 'Only this promotion’s products, with its countdown. The section hides itself once it ends.'

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <FormField label="Flash sale" error={errors['config.promotion_id']} hint={hint} className="sm:col-span-2">
        <Select value={current ?? ALL} onValueChange={(v) => onChange({ ...config, promotion_id: v === ALL ? null : v })}>
          <SelectTrigger className="w-full sm:w-96" aria-label="Flash sale"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All flash sales</SelectItem>
            {flash.items.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
            {missing && current && <SelectItem value={current}>Chosen promotion (not an active flash sale now)</SelectItem>}
          </SelectContent>
        </Select>
      </FormField>
      <FormField label="Number of products" error={errors['config.limit']}>
        <Select value={String(config.limit)} onValueChange={(v) => onChange({ ...config, limit: Number(v) })}>
          <SelectTrigger className="w-full" aria-label="Number of products"><SelectValue /></SelectTrigger>
          <SelectContent>{range(HOT_DEALS_LIMIT.min, HOT_DEALS_LIMIT.max).map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}</SelectContent>
        </Select>
      </FormField>
      <FormField label="“View all” link" error={errors['config.view_all_url']} hint="Optional, e.g. /shop?sale=1.">
        <Input spellCheck={false} maxLength={255} value={config.view_all_url ?? ''} onChange={(e) => onChange({ ...config, view_all_url: e.target.value || null })} />
      </FormField>
    </div>
  )
}

/** "All flash sales" or the chosen promotion's name, for the homepage section list. */
export function HotDealsSummary({ config }: { config: HotDealsConfig }) {
  const flash = useFlashSales()
  if (!config.promotion_id) return <> · All flash sales</>
  const name = flash.items.find((p) => p.id === config.promotion_id)?.name
  return <> · {name ?? 'One promotion'}</>
}
