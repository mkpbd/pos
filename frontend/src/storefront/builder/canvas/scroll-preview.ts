/*
 * B19 canvas `preview-scroll`: scrolls the canvas so a node travels once through the viewport —
 * from just below the fold to just past the top — then brings it back into view. The scroll
 * effects run meanwhile (the canvas turns scroll motion on for the duration).
 */

/** The scroll positions of the run: from where the node's top meets the viewport's bottom to where its bottom meets the top. */
export function scrollPreviewPath(nodeTop: number, nodeHeight: number, viewport: number, maxScroll: number): { from: number; to: number; back: number } {
  const clamp = (value: number) => Math.round(Math.max(0, Math.min(maxScroll, value)))
  return {
    from: clamp(nodeTop - viewport),
    to: clamp(nodeTop + nodeHeight),
    back: clamp(nodeTop + nodeHeight / 2 - viewport / 2),
  }
}

/** Ease in and out (0–1 → 0–1). */
function ease(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2
}

let running = 0

/** Runs the preview for `node`; `done` is called once it is back in view (or cancelled by a newer run). */
export function runScrollPreview(node: HTMLElement, done: () => void, duration = 2400): () => void {
  if (running) cancelAnimationFrame(running)
  const root = document.documentElement
  const rect = node.getBoundingClientRect()
  const top = rect.top + window.scrollY
  const path = scrollPreviewPath(top, rect.height, window.innerHeight, root.scrollHeight - window.innerHeight)
  let start = 0
  let cancelled = false
  window.scrollTo({ top: path.from, behavior: 'auto' })
  const step = (now: number) => {
    if (cancelled) return
    if (!start) start = now
    const t = Math.min(1, (now - start) / duration)
    window.scrollTo({ top: Math.round(path.from + (path.to - path.from) * ease(t)), behavior: 'auto' })
    if (t < 1) running = requestAnimationFrame(step)
    else {
      running = 0
      window.scrollTo({ top: path.back, behavior: 'auto' })
      done()
    }
  }
  running = requestAnimationFrame(step)
  return () => {
    cancelled = true
    if (running) cancelAnimationFrame(running)
    running = 0
  }
}

const ITEM_ID = /^[A-Za-z0-9_-]{1,64}$/

/**
 * B19: the list item (story step, gallery picture or product) clicked inside the node `id`: the
 * nearest `[data-builder-item]` that sits inside that node, or null.
 */
export function itemAt(target: EventTarget | null, id: string | null): string | null {
  if (!id || !(target instanceof Element)) return null
  const item = target.closest<HTMLElement>('[data-builder-item]')
  const node = target.closest<HTMLElement>(`[data-b="${id}"]`)
  const value = item?.dataset.builderItem
  return item && node && node.contains(item) && value && ITEM_ID.test(value) ? value : null
}
