/** Phones are stored without spaces, dashes or brackets (SaveCustomerRequest), so compare them that way. */
export const normalizePhone = (phone: string): string => phone.replace(/[\s()-]/g, '')

/** What the cashier typed in the customer search, as the new customer's likely name or phone. */
export function prefillFromSearch(search: string): { name: string; phone: string } {
  const term = search.trim()
  return /^\+?[0-9 ()-]{5,32}$/.test(term) ? { name: '', phone: term } : { name: term, phone: '' }
}
