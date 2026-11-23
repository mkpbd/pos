/** Sign-in failure reasons with a wording of their own (G1a); others are shown as their code in words. */
const LABELS: Record<string, string> = {
  invalid_two_factor: 'Wrong two-factor code',
  account_locked: 'Account locked',
}

export function failureReasonLabel(reason: string | null): string {
  if (!reason) return 'Failed'
  const known = LABELS[reason]
  if (known) return known
  const text = reason.replaceAll('_', ' ')
  return text.charAt(0).toUpperCase() + text.slice(1)
}
