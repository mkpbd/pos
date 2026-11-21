/*
 * B19: a click on one step of a scroll story (or one card of a horizontal gallery) on the canvas
 * opens that item's card in the inspector. The canvas sends the item id with its `click`
 * (`[data-builder-item]`); the canvas frame records it here, the element's form reads it for its
 * node, and the item list opens and scrolls to the card. Keyboard focus stays where it was.
 */

import { useEffect, useSyncExternalStore } from 'react'

export type ItemReveal = { nodeId: string; itemId: string; token: number }

let current: ItemReveal | null = null
let counter = 0
const listeners = new Set<() => void>()

function emit() {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

const snapshot = () => current

/** A canvas click on an item of a node (null item: a click elsewhere clears any pending request). */
export function revealItem(nodeId: string | null, itemId: string | null | undefined) {
  if (!nodeId || !itemId) {
    if (current === null) return
    current = null
  } else {
    counter += 1
    current = { nodeId, itemId, token: counter }
  }
  emit()
}

/** Marks a request handled (only when it is still the latest). */
export function clearReveal(token: number) {
  if (current?.token !== token) return
  current = null
  emit()
}

/**
 * The pending request for this node, or null. It is handled once the form has committed (the
 * item list opens the card while rendering and scrolls to it in its own effect, before this one).
 */
export function useItemReveal(nodeId: string): ItemReveal | null {
  const reveal = useSyncExternalStore(subscribe, snapshot, snapshot)
  const mine = reveal && reveal.nodeId === nodeId ? reveal : null
  useEffect(() => {
    if (mine) clearReveal(mine.token)
  }, [mine])
  return mine
}
