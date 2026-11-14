const TOOLBAR_HEIGHT = 34

/**
 * Where the selected node's mini toolbar goes (overlay pixels): above the node when there is room;
 * else just below it when that is still on screen; else inside it at the top-right corner — so a
 * section at the very top of the page doesn't get the toolbar over its first heading.
 */
export function toolbarPosition(node: { x: number; y: number; w: number; h: number }, scale: number, area: { w: number; h: number }, toolbarWidth: number) {
  const x = node.x * scale
  const y = node.y * scale
  const w = node.w * scale
  const h = node.h * scale
  const maxLeft = Math.max(0, area.w - toolbarWidth)
  const clampLeft = (left: number) => Math.max(0, Math.min(left, maxLeft))
  if (y >= TOOLBAR_HEIGHT + 2) return { left: clampLeft(x), top: y - TOOLBAR_HEIGHT }
  if (y + h + 2 + TOOLBAR_HEIGHT <= area.h) return { left: clampLeft(x), top: y + h + 2 }
  return { left: clampLeft(x + w - toolbarWidth - 2), top: Math.max(0, y + 2) }
}
