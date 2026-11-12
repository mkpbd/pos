import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { RenderElement } from '../../types'
import ChartFigure from './chart-figure'
import { ChartElement } from './index'
import { chartModel, type ChartModel } from './model'

function props(overrides: Record<string, unknown> = {}) {
  return {
    kind: 'column',
    title: 'Monthly sales',
    description: 'Sales and costs in taka',
    labels: ['Jan', 'Feb', 'Mar'],
    series: [
      { id: 'a', name: 'Sales', values: [120, 150, 170] },
      { id: 'b', name: 'Costs', values: [80, 90, 95] },
    ],
    unit: '৳',
    unit_position: 'before',
    y_starts_at_zero: true,
    show_values: 'none',
    show_legend: true,
    show_table: false,
    height: 320,
    ...overrides,
  }
}

const model = (overrides: Record<string, unknown> = {}) => chartModel(props(overrides)) as ChartModel

function renderChart(overrides: Record<string, unknown> = {}, extra: { texture?: boolean; mode?: 'light' | 'dark' } = {}) {
  return render(<ChartFigure id="e_chart" model={model(overrides)} initialWidth={800} {...extra} />)
}

describe('ChartFigure', () => {
  it('is a captioned figure with an SVG image named by its title and a summary', () => {
    renderChart()
    const figure = screen.getByTestId('builder-chart')
    expect(figure.tagName).toBe('FIGURE')
    expect(figure).toHaveAttribute('data-b', 'e_chart')
    expect(figure.querySelector('figcaption')).toHaveTextContent('Monthly salesSales and costs in taka')
    const img = screen.getByRole('img', { name: /Monthly sales.*Column chart, 2 series, 3 categories/ })
    expect(img.tagName.toLowerCase()).toBe('svg')
    expect(img).toHaveAccessibleDescription('Sales and costs in taka')
  })

  it('keeps the data table in the DOM for screen readers and toggles it visually', async () => {
    renderChart()
    const table = screen.getByRole('table', { name: 'Monthly sales' })
    expect(within(table).getByRole('columnheader', { name: 'Sales' })).toBeInTheDocument()
    expect(within(table).getByRole('rowheader', { name: 'Feb' })).toBeInTheDocument()
    expect(within(table).getByRole('cell', { name: '৳150' })).toBeInTheDocument()
    const wrap = screen.getByTestId('chart-table')
    expect(wrap).toHaveClass('sr-only')
    const toggle = screen.getByRole('button', { name: 'Show data table' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(toggle)
    expect(wrap).not.toHaveClass('sr-only')
    expect(screen.getByRole('button', { name: 'Hide data table' })).toHaveAttribute('aria-expanded', 'true')
  })

  it('shows the table from the start when show_table is on, with a share column for pies', () => {
    renderChart({ kind: 'pie', show_table: true, series: [{ id: 'a', name: 'Sales', values: [50, 30, 20] }] })
    expect(screen.getByTestId('chart-table')).not.toHaveClass('sr-only')
    expect(screen.getByRole('columnheader', { name: 'Share' })).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: '50%' })).toBeInTheDocument()
  })

  it('shows a legend for two series and none for one', () => {
    const { unmount } = renderChart()
    expect(within(screen.getByTestId('chart-legend')).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Sales', 'Costs'])
    unmount()
    renderChart({ series: [{ id: 'a', name: 'Sales', values: [1, 2, 3] }] })
    expect(screen.queryByTestId('chart-legend')).not.toBeInTheDocument()
  })

  it('keeps the legend for bars even when the owner turns it off (identity is never colour alone)', () => {
    renderChart({ show_legend: false })
    expect(screen.getByTestId('chart-legend')).toBeInTheDocument()
  })

  it('hides the legend on request only when line end labels carry identity', () => {
    renderChart({ kind: 'line', show_legend: false })
    expect(screen.queryByTestId('chart-legend')).not.toBeInTheDocument()
    expect(screen.getAllByTestId('chart-end-label').map((t) => t.textContent)).toEqual(['Sales', 'Costs'])
  })

  it('colours marks by fixed slot and keeps text in text tokens', () => {
    renderChart({ show_values: 'last', series: [{ id: 'a', name: 'Sales', values: [1, 2, 3] }] })
    const svg = screen.getByTestId('chart-svg')
    const bars = svg.querySelectorAll('[data-viz-mark="bar"]')
    expect(bars).toHaveLength(3)
    bars.forEach((bar) => expect((bar as SVGElement).style.fill).toBe('var(--viz-s1)'))
    const label = screen.getByTestId('chart-value-label')
    expect(label).toHaveTextContent('৳3')
    expect(label.style.fill).toBe('var(--viz-ink)')
  })

  it('moves between marks with the arrow keys and shows the same tooltip as hover', async () => {
    renderChart()
    const points = screen.getByRole('group', { name: /Data points/ })
    const marks = within(points).getAllByRole('img')
    expect(marks).toHaveLength(6)
    // One tab stop (roving tabindex).
    expect(marks.filter((m) => m.getAttribute('tabindex') === '0')).toHaveLength(1)
    await userEvent.tab() // the first mark
    expect(marks[0]).toHaveFocus()
    expect(marks[0]).toHaveAccessibleName('Jan: Sales ৳120')
    expect(screen.getByRole('tooltip')).toHaveTextContent('Jan৳120Sales')
    expect(screen.getByTestId('chart-focus-ring')).toBeInTheDocument()
    await userEvent.keyboard('{ArrowRight}')
    expect(marks[1]).toHaveFocus()
    expect(screen.getByRole('tooltip')).toHaveTextContent('Jan৳80Costs')
    await userEvent.keyboard('{End}')
    expect(marks[5]).toHaveFocus()
    expect(screen.getByRole('tooltip')).toHaveTextContent('Mar৳95Costs')
    await userEvent.keyboard('{Home}')
    expect(marks[0]).toHaveFocus()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it('shows a tooltip on hover and lifts the hovered bar', () => {
    renderChart()
    const marks = within(screen.getByRole('group', { name: /Data points/ })).getAllByRole('img')
    fireEvent.pointerEnter(marks[2]!)
    expect(screen.getByRole('tooltip')).toHaveTextContent('Feb৳150Sales')
    expect(screen.getByTestId('chart-svg').querySelector('[data-active="true"]')).toBeInTheDocument()
    expect(screen.queryByTestId('chart-focus-ring')).not.toBeInTheDocument()
  })

  it('line charts: one stop per x with a crosshair and every series in the tooltip', async () => {
    renderChart({ kind: 'line' })
    const marks = within(screen.getByRole('group', { name: /Data points/ })).getAllByRole('img')
    expect(marks).toHaveLength(3)
    await userEvent.tab()
    await userEvent.keyboard('{ArrowRight}')
    expect(marks[1]).toHaveAccessibleName('Feb: Sales ৳150; Costs ৳90')
    expect(screen.getByTestId('chart-crosshair')).toBeInTheDocument()
    expect(screen.getByRole('tooltip')).toHaveTextContent('Feb৳150Sales৳90Costs')
  })

  it('pie: one slice per part with its share', async () => {
    renderChart({ kind: 'donut', series: [{ id: 'a', name: 'Sales', values: [50, 30, 20] }] })
    const marks = within(screen.getByRole('group', { name: /Data points/ })).getAllByRole('img')
    expect(marks).toHaveLength(3)
    expect(marks[0]).toHaveAccessibleName('Jan: Sales ৳50 (50%)')
    expect(screen.getByTestId('chart-donut-total')).toHaveTextContent('৳100')
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Jan', 'Feb', 'Mar'])
  })

  it('offers texture and the dark set without turning them on by default', () => {
    const { unmount } = renderChart()
    const figure = screen.getByTestId('builder-chart')
    expect(figure).not.toHaveAttribute('data-texture')
    expect(figure).not.toHaveAttribute('data-mode')
    expect(figure.querySelectorAll('pattern')).toHaveLength(8)
    const bar = figure.querySelector('[data-viz-mark="bar"]') as SVGElement
    expect(bar.style.getPropertyValue('--viz-tex')).toMatch(/^url\(#.+-tex-1\)$/)
    unmount()
    renderChart({}, { texture: true, mode: 'dark' })
    expect(screen.getByTestId('builder-chart')).toHaveAttribute('data-texture', 'on')
    expect(screen.getByTestId('builder-chart')).toHaveAttribute('data-mode', 'dark')
  })

  it('renders owner text as text, never HTML', () => {
    renderChart({ labels: ['<img src=x onerror=alert(1)>', 'b', 'c'] })
    expect(document.querySelector('img[src="x"]')).toBeNull()
    expect(screen.getByRole('rowheader', { name: '<img src=x onerror=alert(1)>' })).toBeInTheDocument()
  })
})

describe('ChartElement', () => {
  const element = (p: Record<string, unknown>) => ({ id: 'e_chart', type: 'chart', props: p, style: {}, visibility: { desktop: true, tablet: true, mobile: true } }) as unknown as RenderElement

  it('lazy-loads the chart chunk and keeps the place while it loads', async () => {
    await act(async () => {
      render(<ChartElement element={element(props())} />)
    })
    expect(await screen.findByRole('img', { name: /Monthly sales/ })).toBeInTheDocument()
    expect(screen.getByTestId('builder-chart')).not.toHaveAttribute('data-loading')
  })

  it('draws nothing for visitors when there is no data', () => {
    const { container } = render(<ChartElement element={element({ labels: [] })} />)
    expect(container).toBeEmptyDOMElement()
  })
})
