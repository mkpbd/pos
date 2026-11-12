/*
 * B8a: where a chart's numbers come from. "Your numbers" is the data grid (B6); the store sources
 * (products per category, customer ratings) are counted by the server, so the grid is replaced by
 * a read-only preview of what the store has now (POST /builder/resolve for this chart).
 */

import { useQuery } from '@tanstack/react-query'
import { DatabaseIcon } from 'lucide-react'
import type { ChartDataSource, ChartElementNode, ChartStoreData } from '@/storefront/builder/types'
import { resolvePreview } from '../api'
import { ChoiceField } from './pickers'

const DATA_SOURCES: readonly { value: ChartDataSource; label: string; hint: string }[] = [
  { value: 'manual', label: 'Numbers I type', hint: 'Type or paste your own numbers in the grid below.' },
  { value: 'store.products_per_category', label: 'Products per category', hint: 'How many products each main category has (up to 12, largest first). Updates by itself.' },
  { value: 'store.rating_breakdown', label: 'Customer ratings', hint: 'How many approved reviews gave 5, 4, 3, 2 and 1 stars. Updates by itself.' },
]

export function DataSourceField({ value, onChange, error }: { value: ChartDataSource; onChange: (value: ChartDataSource) => void; error?: string }) {
  return (
    <ChoiceField
      label="Numbers come from"
      value={value}
      error={error}
      hint={DATA_SOURCES.find((s) => s.value === value)?.hint}
      options={DATA_SOURCES.map(({ value: v, label }) => ({ value: v, label }))}
      onChange={onChange}
    />
  )
}

/** What the store counts for this chart now, as a small read-only table. */
export function StoreChartPreview({ node }: { node: ChartElementNode }) {
  const { data_source: source = 'manual', source_product_id = null } = node.props
  const query = useQuery({
    queryKey: ['store-builder', 'chart-source', source, source_product_id] as const,
    queryFn: ({ signal }) =>
      resolvePreview({ elements: [{ id: node.id, type: 'chart', props: { ...node.props }, translations: node.translations ?? {} }], media_ids: [] }, signal).then(
        (result) => (result.data[node.id] ?? null) as ChartStoreData | null,
      ),
    staleTime: 30_000,
    retry: false,
  })
  const data = query.data
  const series = data?.series[0]
  const empty = !query.isPending && !query.isError && (!data || data.state === 'empty' || !series || data.labels.length === 0)

  return (
    <section aria-labelledby={`${node.id}-store-preview`} className="flex flex-col gap-2 rounded-md border bg-muted/30 p-3" data-testid="chart-store-preview">
      <h3 id={`${node.id}-store-preview`} className="flex items-center gap-1.5 text-sm font-medium">
        <DatabaseIcon className="size-4 text-muted-foreground" aria-hidden /> Numbers from your store
      </h3>
      {query.isPending ? (
        <p className="text-sm text-muted-foreground" role="status">Counting…</p>
      ) : query.isError ? (
        <p className="text-sm text-muted-foreground" role="status">The numbers couldn’t be loaded now; the chart on the page shows them when they are ready.</p>
      ) : empty ? (
        <p className="text-sm text-muted-foreground" role="status">
          {source === 'store.rating_breakdown' ? 'No approved reviews yet' : 'No categories with products yet'} — the chart stays hidden on your shop until there is something to show.
        </p>
      ) : (
        <table className="w-full text-sm">
          <caption className="sr-only">Numbers the chart shows now</caption>
          <thead>
            <tr className="text-left text-xs text-muted-foreground">
              <th scope="col" className="py-1 font-medium">{source === 'store.rating_breakdown' ? 'Rating' : 'Category'}</th>
              <th scope="col" className="py-1 text-right font-medium">{series!.name}</th>
            </tr>
          </thead>
          <tbody>
            {data!.labels.map((label, i) => (
              <tr key={`${label}-${i}`} className="border-t">
                <th scope="row" className="py-1 text-left font-normal">{label}</th>
                <td className="py-1 text-right tabular-nums">{(series!.values[i] ?? 0).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="text-xs text-muted-foreground">You can’t edit these numbers here: they always match your shop. Only counts shoppers could see anyway are used — never sales or customer numbers.</p>
    </section>
  )
}
