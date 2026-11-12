import { useStorefront } from './api'
import { legibleOn } from './color'
import { resolveTypeScale, typeScaleVars } from './type-scale'
import type { BodyFont, ButtonStyle, HeadingCase, HeadingFont, LayoutVariants, StorefrontTheme, ThemeColors } from './types'

const SYSTEM_STACK = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"

const SERIF_FALLBACK = "Georgia, 'Times New Roman', serif"

/*
 * Bangla pages put Hind Siliguri / Baloo Da 2 in front of whichever stack is chosen
 * (storefront.css, `:lang(bn)`), so every stack renders Bengali text.
 */
const HEADING_STACKS: Record<HeadingFont, string> = {
  baloo: `'Baloo 2 Variable', 'Poppins', ${SYSTEM_STACK}`,
  poppins: `'Poppins', ${SYSTEM_STACK}`,
  playfair: `'Playfair Display Variable', ${SERIF_FALLBACK}`,
  jost: `'Jost Variable', 'Poppins', ${SYSTEM_STACK}`,
  system: SYSTEM_STACK,
}

/** The font stack for a theme's heading font; an unknown name gets the system stack. */
export function headingFontStack(font: string): string {
  return Object.hasOwn(HEADING_STACKS, font) ? HEADING_STACKS[font as HeadingFont] : SYSTEM_STACK
}

const BODY_STACKS: Record<BodyFont, string> = {
  poppins: `'Poppins', ${SYSTEM_STACK}`,
  jost: `'Jost Variable', 'Poppins', ${SYSTEM_STACK}`,
  system: SYSTEM_STACK,
}

/** Today's look: what a theme without the T1 layout keys (or with unknown values) gets. */
export const DEFAULT_LAYOUT: LayoutVariants = {
  header_style: 'standard',
  footer_style: 'columns',
  card_style: 'standard',
  hero_style: 'full',
  heading_case: 'normal',
  top_bar: 'none',
}

const LAYOUT_OPTIONS: { [K in keyof LayoutVariants]: readonly LayoutVariants[K][] } = {
  header_style: ['standard', 'centered', 'commerce'],
  footer_style: ['columns', 'showcase', 'widgets'],
  card_style: ['standard', 'minimal', 'commerce'],
  hero_style: ['full', 'tiles', 'sale'],
  heading_case: ['normal', 'lowercase', 'uppercase'],
  top_bar: ['none', 'ticker', 'utility'],
}

const HEADING_TRANSFORMS: Record<HeadingCase, string> = { normal: 'none', lowercase: 'lowercase', uppercase: 'uppercase' }

/** The theme's layout variants with every key set: missing or unknown values fall back to today's look. */
export function resolveLayout(layout: StorefrontTheme['layout']): LayoutVariants {
  const resolved = { ...DEFAULT_LAYOUT }
  for (const key of Object.keys(LAYOUT_OPTIONS) as (keyof LayoutVariants)[]) {
    const value = layout[key]
    if (value !== undefined && (LAYOUT_OPTIONS[key] as readonly string[]).includes(value)) (resolved as Record<string, string>)[key] = value
  }
  return resolved
}

/** The store's layout (header, footer, card, hero, heading case, top bar) plus content width and sticky header. */
export function useStoreLayout(): LayoutVariants & { container_width: number; sticky_header: boolean } {
  const { layout } = useStorefront().theme
  return { ...resolveLayout(layout), container_width: layout.container_width, sticky_header: layout.sticky_header }
}

/**
 * `data-sf-*` attributes for the document root, so custom CSS (and tests) can target a preset
 * or variant: `[data-sf-card="minimal"] …`.
 */
export function themeDataAttributes(theme: StorefrontTheme): Record<string, string> {
  const layout = resolveLayout(theme.layout)
  return {
    'data-sf-preset': theme.preset ?? 'default',
    'data-sf-header': layout.header_style,
    'data-sf-footer': layout.footer_style,
    'data-sf-card': layout.card_style,
    'data-sf-hero': layout.hero_style,
    'data-sf-heading-case': layout.heading_case,
    'data-sf-top-bar': layout.top_bar,
    // B3: a chosen button hover colour replaces the automatic hover (storefront.css `.sf-button`).
    'data-sf-button-hover': theme.colors.button_hover ? 'color' : 'auto',
  }
}

/** Sets the attributes on an element and returns a function that removes them again. */
export function applyDataAttributes(element: HTMLElement, attributes: Record<string, string>): () => void {
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value)
  return () => {
    for (const name of Object.keys(attributes)) element.removeAttribute(name)
  }
}

const BUTTON_RADII: Record<ButtonStyle, string> = {
  pill: '9999px',
  rounded: '0.5rem',
  square: '0px',
}

/**
 * The theme as CSS custom properties (set on :root so portalled UI such as the mobile
 * drawer picks them up). storefront.css maps them into Tailwind colours, fonts and radii.
 */
/** The eleven colours every theme has (the B3 roles below are derived when not set). */
const BASE_COLORS = ['primary', 'primary_foreground', 'accent', 'accent_foreground', 'highlight', 'sale', 'heading', 'text', 'canvas', 'surface', 'border'] as const

/**
 * The B3 colour roles with their fallbacks: a theme from before B3 (or a role left on "automatic")
 * follows the colour that part of the store used until then.
 */
export function resolveColorRoles(colors: ThemeColors): { button: string; button_foreground: string; button_hover: string | null; link: string } {
  return {
    button: colors.button || colors.primary,
    button_foreground: colors.button_foreground || colors.primary_foreground,
    button_hover: colors.button_hover || null,
    link: colors.link || colors.accent,
  }
}

/**
 * The theme as CSS custom properties (set on :root so portalled UI such as the mobile
 * drawer picks them up). storefront.css maps them into Tailwind colours, fonts, radii and
 * text sizes.
 */
export function themeToCssVars(theme: StorefrontTheme): Record<string, string> {
  const vars: Record<string, string> = {}
  for (const name of BASE_COLORS) {
    vars[`--sf-${name.replace(/_/g, '-')}`] = theme.colors[name]
  }
  const roles = resolveColorRoles(theme.colors)
  vars['--sf-button'] = roles.button
  vars['--sf-button-foreground'] = roles.button_foreground
  // Without a hover colour the button keeps its automatic hover; the variable then repeats the button colour.
  vars['--sf-button-hover'] = roles.button_hover ?? roles.button
  vars['--sf-link'] = roles.link
  vars['--sf-font-heading'] = HEADING_STACKS[theme.typography.heading_font] ?? SYSTEM_STACK
  vars['--sf-font-body'] = BODY_STACKS[theme.typography.body_font] ?? SYSTEM_STACK
  vars['--sf-radius-button'] = BUTTON_RADII[theme.shape.button_style] ?? BUTTON_RADII.rounded
  vars['--sf-radius-card'] = `${theme.shape.card_radius}px`
  vars['--sf-container'] = `${theme.layout.container_width}px`
  const headingCase = resolveLayout(theme.layout).heading_case
  vars['--sf-heading-transform'] = HEADING_TRANSFORMS[headingCase]
  // Capitals read better slightly spaced; the theme's heading letter spacing (B3) adds to it.
  const spacing = resolveTypeScale(theme.typography).letter_spacing
  const em = (value: number) => `${Number(value.toFixed(3))}em`
  vars['--sf-heading-tracking'] = headingCase === 'uppercase' ? em(0.04 + spacing) : spacing === 0 ? 'normal' : em(spacing)
  // Headings without a case class: only set when the theme asks for spacing, so they keep inheriting otherwise.
  if (spacing !== 0) vars['--sf-heading-letter-spacing'] = em(spacing)
  Object.assign(vars, typeScaleVars(theme.typography))
  // Stars on a dark surface (`.sf-on-dark`, painted in the heading colour): the primary when it
  // stands out there, else the surface colour (classic's primary is as dark as its footer).
  vars['--sf-star-on-dark'] = legibleOn(theme.colors.heading, [theme.colors.primary, theme.colors.surface, '#ffffff'])
  return vars
}

/** Applies the variables to an element and returns a function that removes them again. */
export function applyCssVars(element: HTMLElement, vars: Record<string, string>): () => void {
  for (const [name, value] of Object.entries(vars)) element.style.setProperty(name, value)
  return () => {
    for (const name of Object.keys(vars)) element.style.removeProperty(name)
  }
}

/** Site-relative paths stay in the SPA; absolute URLs are external links. */
export function isInternalLink(url: string): boolean {
  return url.startsWith('/') && !url.startsWith('//')
}
