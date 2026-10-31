import type { BodyFont, ButtonStyle, HeadingFont, StorefrontTheme } from './types'

const SYSTEM_STACK = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"

const HEADING_STACKS: Record<HeadingFont, string> = {
  baloo: `'Baloo 2 Variable', 'Poppins', ${SYSTEM_STACK}`,
  poppins: `'Poppins', ${SYSTEM_STACK}`,
  system: SYSTEM_STACK,
}

const BODY_STACKS: Record<BodyFont, string> = {
  poppins: `'Poppins', ${SYSTEM_STACK}`,
  system: SYSTEM_STACK,
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
export function themeToCssVars(theme: StorefrontTheme): Record<string, string> {
  const vars: Record<string, string> = {}
  for (const [name, value] of Object.entries(theme.colors)) {
    vars[`--sf-${name.replace(/_/g, '-')}`] = value
  }
  vars['--sf-font-heading'] = HEADING_STACKS[theme.typography.heading_font] ?? SYSTEM_STACK
  vars['--sf-font-body'] = BODY_STACKS[theme.typography.body_font] ?? SYSTEM_STACK
  vars['--sf-radius-button'] = BUTTON_RADII[theme.shape.button_style] ?? BUTTON_RADII.rounded
  vars['--sf-radius-card'] = `${theme.shape.card_radius}px`
  vars['--sf-container'] = `${theme.layout.container_width}px`
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
