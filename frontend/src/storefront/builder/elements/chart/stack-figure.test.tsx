import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import { PageCtx } from '../../render-context'
import type { BuilderData, BuilderPage, RenderElement } from '../../types'
import ChartFigure from './chart-figure'
import { ChartElement } from './index'
import { chartModel, type ChartModel } from './model'

function props(overrides: Record<string, unknown> = {}) {
  return {
    kind: 'stacked-column',
    title: 'Orders by channel',
    description: '',
    labels: ['Jan', 'Feb', 'Mar'],
    series: [
      { id: 'a', name: 'Shop', values: [120, 150, 170] },
      { id: 'b', name: 'Online', values: [80, 90, 95] },
    ],
    unit: '৳',
    unit_position: 'before',
    y_starts_at_zero: true,
    show_values: 'none',
    show_legend: true,
    show_table: false,
    height: 320,
    data_source: 'manual',
    source_product_id: null,
    ...overrides,
  }
}

const model = (overrides: Record<string, unknown> = {}) => chartModel(props(overrides)) as ChartModel

describe('stacked ChartFigure', () => {
  it('names the kind, keeps the legend (even when switched off) and adds a Total column to the table', () => {
    render(<ChartFigure id="e_chart" model={model({ show_legend: false })} initialWidth={800} />)
    expect(screen.getByRole('img', { name: /Orders by channel.*Stacked column chart, 2 series, 3 categories/ })).toBeInTheDocument()
    expect(within(screen.getByTestId('chart-legend')).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Shop', 'Online'])
    const table = screen.getByRole('table', { name: 'Orders by channel' })
    expect(within(table).getAllByRole('columnheader').map((th) => th.textContent)).toEqual(['Category', 'Shop', 'Online', 'Total'])
    const feb = within(table).getByRole('rowheader', { name: 'Feb' }).closest('tr')!
    expect(within(feb).getAllByRole('cell').map((td) => td.textContent)).toEqual(['৳150', '৳90', '৳240'])
  })

  it('one keyboard stop per stack; the tooltip lists each part and the total; the whole stack lifts', async () => {
    render(<ChartFigure id="e_chart" model={model()} initialWidth={800} />)
    const marks = within(screen.getByRole('group', { name: /Data points/ })).getAllByRole('img')
    expect(marks).toHaveLength(3)
    await userEvent.tab()
    expect(marks[0]).toHaveFocus()
    expect(marks[0]).toHaveAccessibleName('Jan: Shop ৳120; Online ৳80; Total ৳200')
    const tip = screen.getByRole('tooltip')
    expect(tip).toHaveTextContent('Jan৳120Shop৳80Online৳200Total')
    const total = tip.querySelector('[data-total="true"]')!
    expect(total).toHaveTextContent('৳200Total')
    // The total row has no series key.
    expect((total.querySelector('[aria-hidden="true"]') as HTMLElement).style.background).toBe('')
    expect(screen.getByTestId('chart-focus-ring')).toBeInTheDocument()
    await userEvent.keyboard('{End}')
    expect(screen.getByRole('tooltip')).toHaveTextContent('Mar৳170Shop৳95Online৳265Total')

    fireEvent.pointerEnter(marks[1]!)
    const lifted = screen.getByTestId('chart-svg').querySelectorAll('[data-active="true"]')
    expect(lifted).toHaveLength(2)
  })

  it('colours parts by fixed slot, bottom-up', () => {
    render(<ChartFigure id="e_chart" model={model({ kind: 'stacked-bar' })} initialWidth={600} />)
    const bars = Array.from(screen.getByTestId('chart-svg').querySelectorAll('[data-viz-mark="bar"]')) as SVGElement[]
    expect(bars).toHaveLength(6)
    expect(bars.map((b) => b.style.fill)).toEqual(['var(--viz-s1)', 'var(--viz-s2)', 'var(--viz-s1)', 'var(--viz-s2)', 'var(--viz-s1)', 'var(--viz-s2)'])
  })
})

describe('store-source ChartElement', () => {
  const element = (p: Record<string, unknown>) => ({ id: 'e_chart', type: 'chart', props: p, style: {}, visibility: { desktop: true, tablet: true, mobile: true } }) as unknown as RenderElement
  const page = (data: Record<string, unknown>): BuilderPage => ({
    document: { id: 'd', key: 'home', title: 'Home', version: 1, source: 'published' },
    sections: [],
    media: {},
    data: data as Record<string, BuilderData>,
  })
  const wrap = (data: Record<string, unknown>, draft: boolean, children: ReactNode) => <PageCtx value={{ page: page(data), draft }}>{children}</PageCtx>
  const ratings = { labels: ['5 stars', '4 stars', '3 stars', '2 stars', '1 star'], series: [{ id: 's1', name: 'Reviews', values: [40, 12, 3, 1, 0] }] }

  it('renders the server counts, not the authored grid', async () => {
    await act(async () => {
      render(wrap({ e_chart: ratings }, false, <ChartElement element={element(props({ kind: 'bar', title: 'Our customers rate us', data_source: 'store.rating_breakdown' }))} />))
    })
    expect(await screen.findByRole('img', { name: /Our customers rate us.*Bar chart, 1 series, 5 categories/ })).toBeInTheDocument()
    expect(screen.getByRole('rowheader', { name: '5 stars' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Reviews' })).toBeInTheDocument()
    expect(screen.queryByRole('rowheader', { name: 'Jan' })).not.toBeInTheDocument()
    expect(screen.queryByTestId('chart-legend')).not.toBeInTheDocument()
  })

  it('drops an empty or missing result publicly, and marks it in a draft', async () => {
    const p = props({ data_source: 'store.products_per_category' })
    const { container, unmount } = render(wrap({ e_chart: { labels: [], series: [], state: 'empty' } }, false, <ChartElement element={element(p)} />))
    expect(container).toBeEmptyDOMElement()
    unmount()
    const missing = render(wrap({}, false, <ChartElement element={element(p)} />))
    expect(missing.container).toBeEmptyDOMElement()
    missing.unmount()
    render(wrap({ e_chart: { labels: [], series: [], state: 'empty' } }, true, <ChartElement element={element(p)} />))
    expect(document.querySelector('[data-node-state="empty"]')).toBeInTheDocument()
  })
})
