import { B17_ENUMS, normalizeColor } from '../validate'

/*
 * B17 ornaments: the names, labels and colour helpers shared by the drawings (./ornaments.tsx)
 * and the editor's picker.
 */

/** The drawings' ids (backend `ornament_names`). */
export const ORNAMENT_NAMES = B17_ENUMS.ornamentName

export type OrnamentName = (typeof ORNAMENT_NAMES)[number]

/** Only these repeat across the width (`repeat: true`; backend `ornament_repeatable`). */
export const REPEATABLE_ORNAMENTS: readonly OrnamentName[] = B17_ENUMS.ornamentRepeatable

export function isOrnamentName(value: unknown): value is OrnamentName {
  return typeof value === 'string' && (ORNAMENT_NAMES as readonly string[]).includes(value)
}

/** The national flag colours of Bangladesh (the flag ribbon ignores the colour props). */
export const FLAG_GREEN = '#006a4e'
export const FLAG_RED = '#f42a41'

/** Fallbacks for theme roles outside the storefront (the editor's picker has no `--sf-*` variables). */
const ROLE_FALLBACKS: Record<string, string> = {
  primary: '#0f766e',
  primary_foreground: '#ffffff',
  accent: '#b45309',
  accent_foreground: '#ffffff',
  highlight: '#f59e0b',
  sale: '#dc2626',
  heading: '#111827',
  text: '#374151',
  canvas: '#ffffff',
  surface: '#f9fafb',
  border: '#e5e7eb',
}

/** A colour prop (`#hex` or `theme:<role>`) as CSS, with a fallback inside the theme variable; undefined when invalid. */
export function ornamentColorCss(value: unknown): string | undefined {
  const color = normalizeColor(value)
  if (!color) return undefined
  if (!color.startsWith('theme:')) return color
  const role = color.slice(6)
  return `var(--sf-${role.replace(/_/g, '-')}, ${ROLE_FALLBACKS[role] ?? 'currentColor'})`
}

/** The ornaments for the editor's picker: name, English and Bangla labels, and whether it can repeat. */
export const ORNAMENTS: readonly { name: OrnamentName; label: string; label_bn: string; repeatable: boolean }[] = (
  [
    ['crescent_star', 'Crescent and star', 'চাঁদ-তারা'],
    ['lantern', 'Lantern', 'ফানুস'],
    ['mosque_dome', 'Mosque dome', 'মসজিদের গম্বুজ'],
    ['alpona_border', 'Alpona border', 'আলপনা পাড়'],
    ['alpona_round', 'Alpona circle', 'গোল আলপনা'],
    ['kash_flower', 'Kash flowers', 'কাশফুল'],
    ['dhak', 'Dhak drum', 'ঢাক'],
    ['diya', 'Diya lamp', 'প্রদীপ'],
    ['shapla', 'Shapla (water lily)', 'শাপলা'],
    ['flag_ribbon', 'Bangladesh flag ribbon', 'জাতীয় পতাকা'],
    ['shaheed_minar', 'Shaheed Minar', 'শহীদ মিনার'],
    ['snowflake', 'Snowflake', 'তুষারকণা'],
    ['gift_box', 'Gift box', 'উপহারের বাক্স'],
    ['confetti', 'Confetti', 'রঙিন কাগজ'],
    ['sparkle', 'Sparkle', 'ঝিলিক'],
    ['sale_tag', 'Sale tag', 'সেল ট্যাগ'],
  ] as const
).map(([name, label, label_bn]) => ({ name, label, label_bn, repeatable: REPEATABLE_ORNAMENTS.includes(name) }))
