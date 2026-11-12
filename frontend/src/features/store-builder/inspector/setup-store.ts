/*
 * The pending "set up this element" request of createElement(): a tiny external store that the
 * inspector's ElementSetupHost renders as a dialog (so the dialog lives inside the app's
 * providers: query client, router, tooltips).
 */

import type { DocumentContext, Element } from '@/storefront/builder/types'
import type { BuilderNode } from './types'

/** A new element to set up: a wrapped section or a B4 element (with the document context its form needs). */
export type SetupRequest = { node: Element; label: string; context: DocumentContext; resolve: (node: BuilderNode | null) => void }
export type SetupSnapshot = { request: SetupRequest | null; host: number | null }

let snapshot: SetupSnapshot = { request: null, host: null }
let hosts: number[] = []
let nextHost = 1
const listeners = new Set<() => void>()

function update(patch: Partial<SetupSnapshot>) {
  snapshot = { ...snapshot, ...patch }
  for (const listener of listeners) listener()
}

export function subscribeSetup(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getSetupSnapshot(): SetupSnapshot {
  return snapshot
}

export function newSetupHostId(): number {
  return nextHost++
}

/** Marks a host as mounted (the first mounted one renders the dialog); returns the unregister function. */
export function registerSetupHost(id: number): () => void {
  hosts = [...hosts, id]
  update({ host: hosts[0] ?? null })
  return () => {
    hosts = hosts.filter((h) => h !== id)
    update({ host: hosts[0] ?? null })
    if (hosts.length === 0) finishSetup(null)
  }
}

/** Opens the setup dialog for the node; resolves with the configured node or null (cancelled). */
export function requestSetup(node: Element, label: string, context: DocumentContext = 'page'): Promise<BuilderNode | null> {
  if (hosts.length === 0) {
    console.warn(`createElement(${node.type}): the Inspector is not mounted, so the setup dialog can't open.`)
    return Promise.resolve(null)
  }
  snapshot.request?.resolve(null)
  return new Promise((resolve) => update({ request: { node, label, context, resolve } }))
}

export function finishSetup(node: BuilderNode | null) {
  const request = snapshot.request
  if (!request) return
  update({ request: null })
  request.resolve(node)
}
