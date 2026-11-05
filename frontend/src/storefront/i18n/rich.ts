import { createElement, Fragment, type ReactNode } from 'react'

/**
 * A translated text with elements in its placeholders: `t()` leaves placeholders it was not
 * given as `{name}`, and this puts the nodes there, so the word order stays the translation's.
 *
 *   rich(t('orders.placedAt'), { date: <time dateTime={iso}>{formatDateTime(iso)}</time> })
 */
export function rich(text: string, nodes: Record<string, ReactNode>): ReactNode {
  return text.split(/(\{\w+\})/g).map((part, index) => {
    const name = /^\{(\w+)\}$/.exec(part)?.[1]
    return createElement(Fragment, { key: index }, name !== undefined && name in nodes ? nodes[name] : part)
  })
}
