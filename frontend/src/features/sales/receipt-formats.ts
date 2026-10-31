export type ReceiptFormat = '58mm' | '80mm' | 'a4'

export const RECEIPT_FORMATS: Record<ReceiptFormat, string> = {
  '58mm': 'Thermal 58 mm',
  '80mm': 'Thermal 80 mm',
  a4: 'A4 invoice',
}
