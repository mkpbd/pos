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
