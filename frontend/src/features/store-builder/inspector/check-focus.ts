/*
 * B10: "Fix it" of the page check focuses a field of the inspector. The request names the field by
 * its form key (`alt`, `link`, `primary.label`, `images.<item id>.alt`, `images.2.alt`,
 * `seo.description`); the inspector finds it in its own DOM:
 *  1. an element marked `data-check-field="<key>"`;
 *  2. inside a list item (`<list>.<item id or index>.…`): the item's card (ItemList marks cards with
 *     `data-item-id`), opened first when collapsed;
 *  3. a label (or an `aria-label`) whose text starts with one of the field's names below;
 *  4. else the first field marked invalid, else the first field of the panel.
 * Fields appear after the tab switch / card opening renders, so the search is retried for a few frames.
 */

/** Label texts of the fields the page check points at, by the last part of the key. */
const FIELD_LABELS: Record<string, readonly string[]> = {
  alt: ['Description (alt text)', 'Name (alt text)', 'Alt text', 'Description'],
  text: ['Heading text', 'Text'],
  html: ['Text', 'Answer', 'Content'],
  label: ['Button text', 'Button label', 'Label', 'Text'],
  link: ['Link', 'Opens', 'Button link', 'Links to'],
  url: ['Link', 'Opens', 'Address', 'Button link'],
  level: ['Size and importance', 'Level'],
  media_id: ['Picture', 'Image', 'Photo', 'Choose'],
  image: ['Sharing image', 'Picture', 'Image'],
  title: ['Title', 'Heading'],
  description: ['Description'],
  notify_email: ['Send a copy', 'Notify', 'E-mail'],
  product_id: ['Product'],
  color: ['Text colour', 'Colour', 'Color'],
  size: ['Text size', 'Size', 'Font size'],
  visibility: ['Show on', 'Desktop', 'Visible'],
}

/** Style tab fields: the groups they sit in (opened first when collapsed). */
const STYLE_GROUPS: Record<string, readonly string[]> = {
  color: ['color', 'button-colors', 'text-effects'],
  typography: ['typography'],
}

const FOCUSABLE = 'input:not([type=hidden]):not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled]), [contenteditable="true"], [role="combobox"], [tabindex]:not([tabindex="-1"])'

const normalize = (text: string | null | undefined) => (text ?? '').replace(/\s+/g, ' ').trim().toLowerCase()

/** The control a label names (its `for`, a control inside it, or the next control after it). */
function controlOf(label: HTMLElement): HTMLElement | null {
  const target = label.getAttribute('for')
  if (target) {
    const byId = label.ownerDocument.getElementById(target)
    if (byId) return byId
  }
  const inside = label.querySelector<HTMLElement>(FOCUSABLE)
  if (inside) return inside
  // A FormField-like wrapper: the label, then its control.
  return label.parentElement?.querySelector<HTMLElement>(FOCUSABLE) ?? null
}

function byLabel(scope: HTMLElement, names: readonly string[]): HTMLElement | null {
  const labels = [...scope.querySelectorAll<HTMLElement>('label, legend')]
  for (const name of names.map(normalize)) {
    for (const label of labels) {
      if (!normalize(label.textContent).startsWith(name)) continue
      const control = label.tagName === 'LEGEND' ? label.parentElement?.querySelector<HTMLElement>(FOCUSABLE) : controlOf(label)
      if (control) return control
    }
    const named = [...scope.querySelectorAll<HTMLElement>('[aria-label]')].find((el) => normalize(el.getAttribute('aria-label')).startsWith(name) && el.matches(FOCUSABLE))
    if (named) return named
  }
  return null
}

/** The list item card a key points into (`images.<id>.alt` / `images.2.alt`), or null. */
function itemCard(root: HTMLElement, field: string): HTMLElement | null {
  const [list, item] = field.split('.')
  if (!list || item === undefined) return null
  const cards = (scope: ParentNode) => [...scope.querySelectorAll<HTMLElement>('[data-item-id]')]
  const lists = [root, ...root.querySelectorAll<HTMLElement>('[data-item-list]')].filter((el) => el.dataset.itemList === list)
  for (const scope of lists.length > 0 ? lists : [root]) {
    const all = cards(scope)
    const byId = all.find((card) => card.dataset.itemId === item)
    if (byId) return byId
    if (/^\d+$/.test(item) && lists.length > 0) {
      // Only the list's own cards (not those of a nested list).
      const own = all.filter((card) => card.parentElement?.closest('[data-item-list]') === scope)
      const card = own[Number(item)]
      if (card) return card
    }
  }
  return null
}

export type FocusOutcome = 'focused' | 'waiting' | 'fallback' | 'none'

/**
 * One attempt to focus `field` inside `root`. `waiting`: a collapsed card was opened (try again
 * after it renders). `fallback` only when `final` (else `none`, try again).
 */
export function focusField(root: HTMLElement, field: string | null, final = false): FocusOutcome {
  const focus = (el: HTMLElement) => {
    el.scrollIntoView?.({ block: 'center' })
    el.focus({ preventScroll: true })
  }
  if (field) {
    const exact = root.querySelector<HTMLElement>(`[data-check-field="${CSS.escape(field)}"]`)
    if (exact) {
      focus(exact.matches(FOCUSABLE) ? exact : (exact.querySelector<HTMLElement>(FOCUSABLE) ?? exact))
      return 'focused'
    }
    let scope = root
    const groups = STYLE_GROUPS[field.split('.')[0] ?? '']
    const group = groups?.map((id) => root.querySelector<HTMLElement>(`[data-testid="style-group-${id}"]`)).find((el) => el !== null)
    if (group) {
      const toggle = group.querySelector<HTMLElement>('button[aria-expanded="false"]')
      if (toggle) {
        toggle.click()
        return 'waiting'
      }
      scope = group
    }
    const card = !group && field.includes('.') ? itemCard(root, field) : null
    if (card) {
      const toggle = card.querySelector<HTMLElement>('button[aria-expanded="false"]')
      if (toggle) {
        toggle.click()
        return 'waiting'
      }
      scope = card
    }
    const parts = field.split('.')
    const last = parts[parts.length - 1] ?? field
    // `primary.label` → "Button text"; `button.url` → "Link"; a plain key by its own name.
    const names = FIELD_LABELS[last] ?? FIELD_LABELS[parts[parts.length - 2] ?? ''] ?? [last.replace(/_/g, ' ')]
    const control = byLabel(scope, names)
    if (control) {
      focus(control)
      return 'focused'
    }
  }
  if (!final && field) return 'none'
  const fallback = root.querySelector<HTMLElement>('[aria-invalid="true"]') ?? root.querySelector<HTMLElement>(`[role="tabpanel"] :is(${FOCUSABLE})`)
  if (fallback) {
    focus(fallback)
    return 'fallback'
  }
  return 'none'
}

/** Retries focusField over a few animation frames (then calls `done`); returns a cancel function. */
export function focusFieldSoon(root: () => HTMLElement | null, field: string | null, done?: () => void, frames = 12): () => void {
  let left = frames
  let handle = 0
  const step = () => {
    const el = root()
    if (el) {
      const outcome = focusField(el, field, left <= 1)
      if (outcome === 'focused' || outcome === 'fallback') return done?.()
    }
    left -= 1
    if (left > 0) handle = requestAnimationFrame(step)
    else done?.()
  }
  handle = requestAnimationFrame(step)
  return () => cancelAnimationFrame(handle)
}
