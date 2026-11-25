import { paymentMethodLabel } from '@/lib/payment-methods'

/**
 * POS1b: how a payment / refund row reads. A gift card row's reference already names the card
 * ("Gift card ••••1234", "Credit note ••••9WXY"; never the full code), so it is shown in place of
 * label + reference; a bare "••••1234" is put after the label.
 * POS1c: an `exchange` row reads "Exchange RET-…" (on the new sale; the return number) or
 * "Exchange INV-…" (on the return; the new sale's number). A missing label falls back to the method's.
 */
export function paymentRowLabel(p: { method: string; method_label: string | null; reference: string | null }): { label: string; reference: string | null } {
  const reference = p.reference?.trim() || null
  const methodLabel = p.method_label?.trim() || paymentMethodLabel(p.method)
  if (reference && p.method === 'gift_card' && /[•*]{2,}\s?\w{4}$/.test(reference)) {
    return { label: /^[•*]/.test(reference) ? `${methodLabel} ${reference}` : reference, reference: null }
  }
  if (reference && p.method === 'exchange') return { label: `${methodLabel} ${reference}`, reference: null }
  return { label: methodLabel, reference }
}
