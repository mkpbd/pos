/**
 * Grid columns for the demo gallery (B11: nine stores), so no row ends with a lone card on wide
 * screens: four across for 4 / 8 / 12, three across for 3 / 6 / 9, two across for other even
 * counts. A phone always gets one column.
 */
export function galleryColumns(count: number): string {
  if (count >= 4 && count % 4 === 0) return 'sm:grid-cols-2 xl:grid-cols-4'
  if (count % 3 === 0) return 'md:grid-cols-3'
  if (count % 2 === 0) return 'sm:grid-cols-2'
  return count === 1 ? '' : 'sm:grid-cols-2 lg:grid-cols-3'
}
