import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { BarChart } from '@/components/common/charts/bar-chart'
import { compactNumber, labelledIndexes, niceTicks, plotValue } from '@/components/common/charts/chart-utils'
import { TrendChart, type TrendPoint } from '@/components/common/charts/trend-chart'
import { formatMoney } from '@/lib/money'

const points: TrendPoint[] = [
  { key: '2026-11-01', label: '1 Nov', longLabel: 'Sun, 1 Nov 2026', values: { pos: '1000.00', online: '200.00', total: '1200.00' } },
  { key: '2026-11-02', label: '2 Nov', longLabel: 'Mon, 2 Nov 2026', values: { pos: '1500.50', online: '0.00', total: '1500.50' } },
  { key: '2026-11-03', label: '3 Nov', longLabel: 'Tue, 3 Nov 2026', values: { pos: '800.00', online: '450.00', total: '1250.00' } },
]
const series = [{ key: 'pos', label: 'POS' }, { key: 'online', label: 'Online' }]
const money = (v: string) => formatMoney(v, 'BDT')

describe('chart utils', () => {
  it('plots decimal strings without trusting them', () => {
    expect(plotValue('1234.50')).toBe(1234.5)
    expect(plotValue('abc')).toBe(0)
    expect(plotValue(null)).toBe(0)
  })

  it('makes round ticks from zero and compact axis labels', () => {
    expect(niceTicks(0, 1450)).toEqual([0, 500, 1000, 1500])
    expect(niceTicks(-120, 380)[0]).toBeLessThanOrEqual(-120)
    expect(compactNumber(1250)).toBe('1.3k')
    expect(compactNumber(2_400_000)).toBe('2.4M')
    expect(compactNumber(-500)).toBe('−500')
  })

  it('labels only as many x positions as fit, always the last one', () => {
    expect([...labelledIndexes(5, 600)].sort()).toEqual([0, 1, 2, 3, 4])
    const many = labelledIndexes(30, 300)
    expect(many.size).toBeLessThanOrEqual(5)
    expect(many.has(29)).toBe(true)
  })
})

describe('TrendChart', () => {
  it('draws one path per series with a legend and a visually hidden data table', () => {
    const { container } = render(<TrendChart title="Daily net sales" data={points} series={series} variant="area" stacked total={{ key: 'total', label: 'Net sales' }} formatValue={money} />)

    expect(screen.getByRole('group', { name: /Daily net sales/ })).toBeInTheDocument()
    expect(container.querySelectorAll('path[data-series]')).toHaveLength(2)
    const legend = screen.getByRole('list', { name: 'Daily net sales legend' })
    expect(within(legend).getByText('POS')).toBeInTheDocument()
    expect(within(legend).getByText('Online')).toBeInTheDocument()

    const table = screen.getByRole('table', { name: 'Daily net sales' })
    expect(table).toHaveClass('sr-only')
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Date', 'POS', 'Online', 'Net sales'])
    const row = within(table).getByRole('row', { name: /Mon, 2 Nov 2026/ })
    expect(within(row).getAllByRole('cell').map((c) => c.textContent)).toEqual(['BDT 1,500.50', 'BDT 0.00', 'BDT 1,500.50'])
  })

  it('is one tab stop; arrow keys move between points and show the tooltip', async () => {
    const user = userEvent.setup()
    render(
      <>
        <button type="button">before</button>
        <TrendChart title="Daily net sales" data={points} series={series} total={{ key: 'total', label: 'Net sales' }} formatValue={money} />
      </>,
    )
    await user.click(screen.getByRole('button', { name: 'before' }))
    await user.tab()

    // Focus starts on the latest point.
    const last = screen.getByRole('img', { name: 'Tue, 3 Nov 2026: POS BDT 800.00, Online BDT 450.00, Net sales BDT 1,250.00' })
    expect(last).toHaveFocus()
    expect(screen.getByRole('tooltip')).toHaveTextContent('Tue, 3 Nov 2026')
    expect(screen.getAllByRole('img').filter((el) => el.getAttribute('tabindex') === '0')).toHaveLength(1)

    await user.keyboard('{ArrowLeft}')
    expect(screen.getByRole('img', { name: /^Mon, 2 Nov 2026/ })).toHaveFocus()
    expect(screen.getByRole('tooltip')).toHaveTextContent('BDT 1,500.50')

    await user.keyboard('{Home}')
    expect(screen.getByRole('img', { name: /^Sun, 1 Nov 2026/ })).toHaveFocus()
    await user.keyboard('{End}')
    expect(screen.getByRole('img', { name: /^Tue, 3 Nov 2026/ })).toHaveFocus()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    await user.tab()
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it('shows the nearest point on hover', () => {
    render(<TrendChart title="Sales" data={points} series={[{ key: 'pos', label: 'POS' }]} formatValue={money} />)
    const svg = screen.getByRole('group', { name: /Sales/ })
    svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 600, height: 240, right: 600, bottom: 240, x: 0, y: 0, toJSON: () => ({}) })

    fireEvent.pointerMove(svg, { clientX: 590, clientY: 100 })
    expect(screen.getByRole('tooltip')).toHaveTextContent('Tue, 3 Nov 2026')
    expect(screen.getByRole('tooltip')).toHaveTextContent('BDT 800.00')
    fireEvent.pointerLeave(svg)
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it('says so when there is nothing to plot', () => {
    render(<TrendChart title="Sales" data={[]} series={series} formatValue={money} emptyText="No sales in this period." />)
    expect(screen.getByText('No sales in this period.')).toBeInTheDocument()
    expect(screen.queryByRole('group')).not.toBeInTheDocument()
  })
})

describe('BarChart', () => {
  const bars = [
    { key: 'pos', label: 'POS', value: '100000.00', details: [{ label: 'Orders', value: '250' }] },
    { key: 'online', label: 'Online', value: '25000.00', details: [{ label: 'Orders', value: '60' }] },
  ]

  it('draws bars on one scale with direct labels and a hidden table', () => {
    const { container } = render(<BarChart title="Sales by channel" data={bars} formatValue={money} categoryHeader="Channel" valueHeader="Net sales" />)

    const widths = [...container.querySelectorAll('rect[data-bar]')].map((r) => Number(r.getAttribute('width')))
    expect(widths).toEqual([100, 25])
    expect(screen.getAllByText('BDT 100,000.00').length).toBeGreaterThan(0)
    const table = screen.getByRole('table', { name: 'Sales by channel' })
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Channel', 'Net sales', 'Orders'])
    expect(within(within(table).getByRole('row', { name: /Online/ })).getAllByRole('cell').map((c) => c.textContent)).toEqual(['BDT 25,000.00', '60'])
  })

  it('moves between bars with the arrow keys and shows details on focus', async () => {
    const user = userEvent.setup()
    render(<BarChart title="Sales by channel" data={bars} formatValue={money} />)
    await user.tab()

    expect(screen.getByRole('listitem', { name: 'POS: BDT 100,000.00, Orders 250' })).toHaveFocus()
    expect(screen.getByRole('tooltip')).toHaveTextContent('Orders250')
    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('listitem', { name: /^Online/ })).toHaveFocus()
    expect(screen.getByRole('tooltip')).toHaveTextContent('60')
    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('listitem', { name: /^Online/ })).toHaveFocus()
  })
})
