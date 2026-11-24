import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api/client'
import type { BarcodeFormat } from '@/features/labels/barcode/barcode'

/** `GET /products/labels`: one row per variant (or per received batch) with its default quantity. */
export type LabelData = {
  variant_id: string
  product_name: string
  variant_name: string | null
  sku: string
  barcode: string | null
  barcode_format: BarcodeFormat | null
  price: string
  currency: string
  unit: string | null
  quantity: number | string
  batch_number?: string | null
  expires_on?: string | null
}

export type LabelShop = { name: string; currency: string }

export type LabelsResponse = { labels: LabelData[]; shop: LabelShop | null }

/** Where labels come from: picked variants, a goods receipt, a purchase order or a category. */
export type LabelSource =
  | { variant_ids: string[] }
  | { goods_receipt_id: string }
  | { purchase_order_id: string }
  | { category_id: string }

/** Variant ids per request: keeps the query string well under server URL limits. */
const IDS_PER_REQUEST = 100

function sourceQuery(source: LabelSource): string[] {
  if ('variant_ids' in source) {
    const chunks: string[] = []
    for (let i = 0; i < source.variant_ids.length; i += IDS_PER_REQUEST) {
      const params = new URLSearchParams()
      for (const id of source.variant_ids.slice(i, i + IDS_PER_REQUEST)) params.append('variant_ids[]', id)
      chunks.push(params.toString())
    }
    return chunks
  }
  return [new URLSearchParams(Object.entries(source) as [string, string][]).toString()]
}

/** The endpoint answers `{labels, shop}`; a bare list is accepted too. */
function normalise(data: LabelsResponse | LabelData[]): LabelsResponse {
  return Array.isArray(data) ? { labels: data, shop: null } : { labels: data.labels ?? [], shop: data.shop ?? null }
}

export async function fetchLabels(source: LabelSource, signal?: AbortSignal): Promise<LabelsResponse> {
  const out: LabelsResponse = { labels: [], shop: null }
  for (const qs of sourceQuery(source)) {
    const res = await api.get<LabelsResponse | LabelData[]>(`/products/labels?${qs}`, { signal })
    const page = normalise(res.data)
    out.labels.push(...page.labels)
    out.shop ??= page.shop
  }
  return out
}

/** Label data for the source in the page URL (opened from a receipt, order or product). */
export function useLabelSourceQuery(source: LabelSource | null) {
  return useQuery({
    queryKey: ['labels', 'source', source],
    queryFn: ({ signal }) => fetchLabels(source!, signal),
    enabled: source !== null,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  })
}

/** Label data fetched on demand (adding items on the page). */
export function useFetchLabelsMutation() {
  return useMutation({ mutationFn: (source: LabelSource) => fetchLabels(source) })
}

export type GeneratedBarcode = { variant_id: string; barcode: string; generated: boolean }

/** `POST /products/barcodes/generate` takes at most this many variants. */
export const GENERATE_LIMIT = 500

/** Gives variants without a barcode an in-store EAN-13 (prefix 2). */
export function useGenerateBarcodesMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (variantIds: string[]) => {
      const out: GeneratedBarcode[] = []
      for (let i = 0; i < variantIds.length; i += GENERATE_LIMIT) {
        const res = await api.post<GeneratedBarcode[]>('/products/barcodes/generate', { variant_ids: variantIds.slice(i, i + GENERATE_LIMIT) })
        out.push(...res.data)
      }
      return out
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['products'] })
      // Cached label data from the URL would still show the old (missing) barcodes.
      await queryClient.invalidateQueries({ queryKey: ['labels'], refetchType: 'none' })
    },
  })
}
