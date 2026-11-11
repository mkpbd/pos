import { createElement } from 'react'
import { elementIcon } from './catalogue'

/** The catalogue icon of an element type (decorative). */
export function ElementIcon({ type, className }: { type: string; className?: string }) {
  return createElement(elementIcon(type), { className, 'aria-hidden': true })
}
