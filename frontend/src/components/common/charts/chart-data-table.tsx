import type { ReactNode } from 'react'

export type ChartTableColumn = { key: string; label: string }

/**
 * The chart's data as a plain table, visually hidden: screen readers and keyboard users get every
 * value without hovering. `rows[].cells` are already formatted for display.
 */
export function ChartDataTable({ caption, header, columns, rows }: {
  caption: ReactNode
  /** Heading of the first (row label) column. */
  header: string
  columns: ChartTableColumn[]
  rows: { key: string; label: string; cells: Record<string, string> }[]
}) {
  return (
    <table className="sr-only">
      <caption>{caption}</caption>
      <thead>
        <tr>
          <th scope="col">{header}</th>
          {columns.map((c) => <th key={c.key} scope="col">{c.label}</th>)}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.key}>
            <th scope="row">{row.label}</th>
            {columns.map((c) => <td key={c.key}>{row.cells[c.key] ?? '—'}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  )
}
