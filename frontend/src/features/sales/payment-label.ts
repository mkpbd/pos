/**
 * POS1b: how a payment / refund row reads. A gift card row's reference already names the card
 * ("Gift card ••••1234", "Credit note ••••9WXY"; never the full code), so it is shown in place of
 * label + reference; a bare "••••1234" is put after the label.
 */
export function paymentRowLabel(p: { method: string; method_label: string; reference: string | null }): { label: string; reference: string | null } {
  const reference = p.reference?.trim() || null
  if (reference && p.method === 'gift_card' && /[•*]{2,}\s?\w{4}$/.test(reference)) {
    return { label: /^[•*]/.test(reference) ? `${p.method_label} ${reference}` : reference, reference: null }
  }
  return { label: p.method_label, reference }
}
