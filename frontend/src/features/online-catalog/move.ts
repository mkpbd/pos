/** A chosen record in an ordered picker; `image_url` undefined = the list shows no thumbnails. */
export type PickedItem = { id: string; name: string; image_url?: string | null; sku?: string | null }

/** Moves an item up (-1) or down (+1); no-op at the edges. */
export function moveItem<T>(list: T[], index: number, direction: -1 | 1): T[] {
  const target = index + direction
  if (target < 0 || target >= list.length) return list
  const copy = [...list]
  const [item] = copy.splice(index, 1)
  if (item !== undefined) copy.splice(target, 0, item)
  return copy
}
