/*
 * The canvas draws text elements from the editor's unsaved draft, before the server has sanitized
 * them (ADR-009). The canvas shares the admin's origin, so their HTML is cleaned here as well:
 * no scripts, embeds, styles or forms, no event-handler attributes, and links / sources only
 * site-relative, http(s), mailto or tel.
 */

const DROP = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'LINK', 'META', 'BASE', 'FORM', 'INPUT', 'BUTTON', 'TEXTAREA', 'SELECT', 'SVG', 'MATH', 'TEMPLATE', 'NOSCRIPT', 'FRAME', 'FRAMESET'])
const URL_ATTRIBUTES = new Set(['href', 'src', 'srcset', 'action', 'formaction', 'xlink:href', 'poster', 'background'])
const SAFE_URL = /^(?:\/(?![/\\])|#|https?:\/\/|mailto:|tel:)/i
/** The only inline style the rich-text editor writes. */
const TEXT_ALIGN = /^text-align:\s*(?:left|center|right|justify);?$/i

/** `dropClassAndId`: custom HTML (B4) keeps no `class` / `id` either — the server drops them, styling goes through the node style. */
export function sanitizeHtml(html: string, options: { dropClassAndId?: boolean } = {}): string {
  if (typeof html !== 'string' || html === '') return ''
  const template = document.createElement('template')
  template.innerHTML = html
  const walk = (parent: ParentNode) => {
    for (const child of Array.from(parent.children)) {
      if (DROP.has(child.tagName.toUpperCase())) {
        child.remove()
        continue
      }
      for (const attribute of Array.from(child.attributes)) {
        const name = attribute.name.toLowerCase()
        const value = attribute.value.trim()
        const style = name === 'style' && !TEXT_ALIGN.test(value)
        const identity = options.dropClassAndId === true && (name === 'class' || name === 'id')
        if (name.startsWith('on') || style || identity || (URL_ATTRIBUTES.has(name) && !SAFE_URL.test(value))) child.removeAttribute(attribute.name)
      }
      walk(child)
    }
  }
  walk(template.content)
  return template.innerHTML
}

/*
 * B10: what the on-canvas rich text editor commits — the server's tags only (ADR-009 whitelist:
 * p, h2–h4, strong, em, u, s, a[href|title|target], ul, ol, li, blockquote, img[src|alt|width|height],
 * table parts, figure, figcaption, hr, br). The browser's editing markup is mapped onto them (b →
 * strong, i → em, a <div> line → p); other wrappers (span, font) are unwrapped, keeping their text.
 */
const RICH_ALLOWED: Record<string, readonly string[]> = {
  P: [], H2: [], H3: [], H4: [], STRONG: [], EM: [], U: [], S: [], UL: [], OL: [], LI: [], BLOCKQUOTE: [], BR: [], HR: [],
  A: ['href', 'title', 'target'],
  IMG: ['src', 'alt', 'width', 'height'],
  TABLE: [], THEAD: [], TBODY: [], TR: [], TH: [], TD: [], FIGURE: [], FIGCAPTION: [],
}
const RENAME: Record<string, string> = { B: 'STRONG', I: 'EM', STRIKE: 'S', DEL: 'S', H1: 'H2', H5: 'H4', H6: 'H4' }
const BLOCKS = new Set(['P', 'DIV', 'UL', 'OL', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'TABLE', 'FIGURE', 'HR'])
/** Links the server keeps: site-relative, anchors, http(s) and mailto. */
const RICH_URL = /^(?:\/(?![/\\])|#|https?:\/\/|mailto:)/i

function renamed(element: Element, tag: string): Element {
  const next = element.ownerDocument.createElement(tag)
  for (const attribute of Array.from(element.attributes)) next.setAttribute(attribute.name, attribute.value)
  next.append(...Array.from(element.childNodes))
  element.replaceWith(next)
  return next
}

export function sanitizeRichText(html: string): string {
  if (typeof html !== 'string' || html.trim() === '') return ''
  const template = document.createElement('template')
  template.innerHTML = html
  const walk = (parent: Node) => {
    for (const child of Array.from(parent.childNodes)) {
      if (child.nodeType === Node.COMMENT_NODE) {
        child.remove()
        continue
      }
      if (child.nodeType !== Node.ELEMENT_NODE) continue
      let element = child as Element
      const tag = element.tagName.toUpperCase()
      if (DROP.has(tag)) {
        element.remove()
        continue
      }
      // A line the browser wrote as <div>: a paragraph, unless it holds blocks itself (then unwrapped).
      const target = tag === 'DIV' ? (Array.from(element.children).some((c) => BLOCKS.has(c.tagName.toUpperCase())) ? null : 'P') : (RENAME[tag] ?? tag)
      if (target === null || !Object.hasOwn(RICH_ALLOWED, target)) {
        walk(element)
        element.replaceWith(...Array.from(element.childNodes))
        continue
      }
      if (target !== tag) element = renamed(element, target)
      const keep = RICH_ALLOWED[target]!
      for (const attribute of Array.from(element.attributes)) {
        const name = attribute.name.toLowerCase()
        const value = attribute.value.trim()
        const bad =
          !keep.includes(name) ||
          ((name === 'href' || name === 'src') && !RICH_URL.test(value)) ||
          (name === 'target' && value !== '_blank') ||
          ((name === 'width' || name === 'height') && !/^\d{1,4}$/.test(value))
        if (bad) element.removeAttribute(attribute.name)
      }
      walk(element)
    }
  }
  walk(template.content)
  return template.innerHTML.trim()
}
