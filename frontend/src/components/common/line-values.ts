import type { VariantOption } from '@/components/common/variant-options'

export type LineValue = {
  variant: VariantOption | null
  quantity: string
  unit_cost: string
  tax_rate: string
  batch_number: string
  expires_on: string
  batch_id: string | null
  /** Set when the line comes from another document (purchase order line, receipt line). */
  source_line_id?: string
  /** Upper bound shown to the user (e.g. open quantity on the order). */
  max_quantity?: string
}

export type LinesForm = { lines: LineValue[] }

export const emptyLine = (): LineValue => ({ variant: null, quantity: '', unit_cost: '', tax_rate: '', batch_number: '', expires_on: '', batch_id: null })
