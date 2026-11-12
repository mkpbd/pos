import type { ThemeColor, ThemeRoleColor } from '@/features/storefront/api'
import { effectiveColor, type ThemeFormValues } from '@/features/storefront/theme-form'

type Colors = ThemeFormValues['colors']
type Role = ThemeColor | ThemeRoleColor

/** Font names as the owner reads them. */
export const FONT_LABELS: Record<string, string> = {
  baloo: 'Baloo (rounded, playful)',
  poppins: 'Poppins (geometric)',
  playfair: 'Playfair Display (serif, elegant)',
  jost: 'Jost (clean, modern)',
  system: 'System font',
}

/** The typefaces as the storefront stacks them (storefront/theme.ts), for the previews. */
export const FONT_FAMILIES: Record<string, string> = {
  baloo: "'Baloo 2 Variable', 'Poppins', system-ui, sans-serif",
  poppins: "'Poppins', system-ui, sans-serif",
  playfair: "'Playfair Display Variable', Georgia, serif",
  jost: "'Jost Variable', system-ui, sans-serif",
  system: 'system-ui, sans-serif',
}

export const BUTTON_LABELS: Record<string, string> = { pill: 'Pill', rounded: 'Rounded', square: 'Square' }

/** The button corner radius of each style, as the storefront draws it. */
export const BUTTON_RADII: Record<string, string> = { pill: '9999px', rounded: '0.5rem', square: '0px' }

export const HEADING_WEIGHTS: { value: number; label: string }[] = [
  { value: 400, label: 'Regular' },
  { value: 500, label: 'Medium' },
  { value: 600, label: 'Semibold' },
  { value: 700, label: 'Bold (as designed)' },
  { value: 800, label: 'Extra bold' },
  { value: 900, label: 'Black' },
]

export type PaletteColors = Record<ThemeColor, string> & Record<Exclude<ThemeRoleColor, 'button_hover'>, string>

export type PredefinedPalette = { key: string; name: string; description: string; colors: PaletteColors }

/** Buttons in the primary pair and links in the secondary colour, as before B3; the hover stays automatic. */
function withRoles(colors: Record<ThemeColor, string>): PaletteColors {
  return { ...colors, button: colors.primary, button_foreground: colors.primary_foreground, link: colors.accent }
}

/**
 * Eight original colour palettes; one click sets every colour role (fonts, sizes and layout stay).
 * Each one passes WCAG AA (4.5:1) for its text pairs — checked in theme-options.test.ts.
 */
export const PREDEFINED_PALETTES: PredefinedPalette[] = [
  {
    key: 'fresh-mint',
    name: 'Fresh Mint',
    description: 'Cool teal and white: clean, healthy, calm.',
    colors: withRoles({ primary: '#0f766e', primary_foreground: '#ffffff', accent: '#134e4a', accent_foreground: '#ffffff', highlight: '#15803d', sale: '#c2410c', heading: '#10302c', text: '#475569', canvas: '#f0fdfa', surface: '#ffffff', border: '#cce7e1' }),
  },
  {
    key: 'ocean',
    name: 'Ocean Blue',
    description: 'Trustworthy blues for electronics and services.',
    colors: withRoles({ primary: '#1d4ed8', primary_foreground: '#ffffff', accent: '#0e7490', accent_foreground: '#ffffff', highlight: '#047857', sale: '#be123c', heading: '#0f1f3d', text: '#475569', canvas: '#f4f8fc', surface: '#ffffff', border: '#dbe4f0' }),
  },
  {
    key: 'terracotta',
    name: 'Terracotta',
    description: 'Warm clay and cream for crafts and home goods.',
    colors: withRoles({ primary: '#b45309', primary_foreground: '#ffffff', accent: '#7c2d12', accent_foreground: '#ffffff', highlight: '#4d7c0f', sale: '#b91c1c', heading: '#3b2416', text: '#5b4636', canvas: '#fbf5ee', surface: '#ffffff', border: '#ead9c6' }),
  },
  {
    key: 'midnight-gold',
    name: 'Midnight Gold',
    description: 'Deep navy with a golden call to action.',
    colors: withRoles({ primary: '#fbbf24', primary_foreground: '#1c1400', accent: '#1e293b', accent_foreground: '#ffffff', highlight: '#047857', sale: '#dc2626', heading: '#0f172a', text: '#475569', canvas: '#f8fafc', surface: '#ffffff', border: '#e2e8f0' }),
  },
  {
    key: 'berry',
    name: 'Berry Pop',
    description: 'Playful pink and violet for kids and gifts.',
    colors: withRoles({ primary: '#db2777', primary_foreground: '#ffffff', accent: '#6d28d9', accent_foreground: '#ffffff', highlight: '#0f766e', sale: '#c2410c', heading: '#3b0a2a', text: '#5b4b5a', canvas: '#fdf4f8', surface: '#ffffff', border: '#f3d9e6' }),
  },
  {
    key: 'spice',
    name: 'Spice Market',
    description: 'Saffron and maroon for food and festive sales.',
    colors: withRoles({ primary: '#f59e0b', primary_foreground: '#2b1600', accent: '#9f1239', accent_foreground: '#ffffff', highlight: '#15803d', sale: '#b91c1c', heading: '#3f0d1a', text: '#5c4a4a', canvas: '#fff8ee', surface: '#ffffff', border: '#f0dfc8' }),
  },
  {
    key: 'monochrome',
    name: 'Monochrome',
    description: 'Black, white and greys: lets the products speak.',
    colors: withRoles({ primary: '#18181b', primary_foreground: '#ffffff', accent: '#3f3f46', accent_foreground: '#ffffff', highlight: '#15803d', sale: '#dc2626', heading: '#09090b', text: '#52525b', canvas: '#fafafa', surface: '#ffffff', border: '#e4e4e7' }),
  },
  {
    key: 'forest',
    name: 'Forest Lodge',
    description: 'Pine green and ochre on warm paper.',
    colors: withRoles({ primary: '#166534', primary_foreground: '#ffffff', accent: '#854d0e', accent_foreground: '#ffffff', highlight: '#15803d', sale: '#b91c1c', heading: '#14261a', text: '#4a5547', canvas: '#f7f5ec', surface: '#fffefa', border: '#e3dfcc' }),
  },
]

const same = (a: string | null | undefined, b: string | null | undefined) => !!a && !!b && a.toLowerCase() === b.toLowerCase()

/**
 * Roles that started as a copy of another one: while they still match it (or are unset) they move
 * with it, so changing the primary colour still recolours the buttons as before B3.
 */
const FOLLOWERS: Partial<Record<ThemeColor, ThemeRoleColor>> = { primary: 'button', primary_foreground: 'button_foreground', accent: 'link' }


export function withColor(colors: Colors, role: Role, value: string | null): Colors {
  const next: Colors = { ...colors, [role]: value }
  const follower = FOLLOWERS[role as ThemeColor]
  if (follower && value && same(colors[follower], colors[role])) next[follower] = value
  return next
}

/** Every colour of a predefined palette (the button hover goes back to automatic). */
export function applyPalette(colors: Colors, palette: PredefinedPalette): Colors {
  return { ...colors, ...palette.colors, button_hover: null }
}

export function paletteMatches(colors: Colors, palette: PredefinedPalette): boolean {
  return (Object.keys(palette.colors) as (keyof PredefinedPalette['colors'])[]).every((key) => same(effectiveColor(colors, key), palette.colors[key]))
}


