import { mkdirSync, writeFileSync } from 'node:fs'
import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test'

/*
 * Store builder B6 chart element on a mocked store: every chart kind (column, bar, line, area, pie,
 * donut) drawn at 1366 px and 375 px — no horizontal scroll, labels that never collide, a tooltip on
 * hover / tap and on keyboard focus (arrow keys move between marks), and the data table toggle.
 * Screenshots are attached to the test results for review against the dataviz anti-patterns.
 */

const envelope = (data: unknown) => ({ success: true, data, meta: { request_id: 'e2e' } })
const VISIBLE = { desktop: true, tablet: true, mobile: true }

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const chart = (id: string, props: Record<string, unknown>) => ({
  id,
  type: 'chart',
  style: {},
  visibility: VISIBLE,
  props: { title: '', description: '', unit: '', unit_position: 'after', y_starts_at_zero: true, show_values: 'none', show_legend: true, show_table: false, height: 320, ...props },
})

const CHARTS = [
  chart('c_column', {
    kind: 'column',
    title: 'Sales and costs',
    description: 'Monthly totals in taka, first half of the year.',
    labels: MONTHS.slice(0, 6),
    series: [
      { id: 's1', name: 'Sales', values: [120000, 150000, 170000, 160000, 210000, 260000] },
      { id: 's2', name: 'Costs', values: [80000, 90000, 95000, 120000, 130000, 140000] },
    ],
    unit: '৳',
    unit_position: 'before',
  }),
  chart('c_bar', {
    kind: 'bar',
    title: 'Best-selling categories',
    description: 'Units sold last month.',
    labels: ['Fresh vegetables and leafy greens', 'Seasonal fruits', 'Rice, flour and lentils', 'Cooking oil', 'Tea and coffee', 'Baby care'],
    series: [{ id: 's1', name: 'Units', values: [940, 720, 610, 380, 290, 150] }],
    unit: 'pcs',
    show_values: 'all-small',
  }),
  chart('c_line', {
    kind: 'line',
    title: 'Orders by channel',
    description: 'Orders per month across the year.',
    labels: MONTHS,
    series: [
      { id: 's1', name: 'Online', values: [310, 340, 360, 420, 480, 510, 560, 590, 620, 700, 760, 820] },
      { id: 's2', name: 'In store', values: [520, 500, 510, 490, 470, 480, 460, 450, 470, 440, 430, 420] },
      { id: 's3', name: 'Phone', values: [120, 130, 125, 140, 150, 145, 160, 170, 165, 180, 190, 200] },
    ],
    show_values: 'last',
  }),
  chart('c_area', {
    kind: 'area',
    title: 'Visitors',
    description: 'Daily visitors over the last 24 days.',
    labels: Array.from({ length: 24 }, (_, i) => `Day ${i + 1}`),
    series: [{ id: 's1', name: 'Visitors', values: [820, 900, 870, 950, 1010, 1200, 1340, 1100, 980, 1050, 1120, 1180, 1250, 1300, 1280, 1400, 1550, 1600, 1580, 1650, 1700, 1820, 1900, 2050] }],
  }),
  chart('c_pie', {
    kind: 'pie',
    title: 'Payment methods',
    description: 'Share of orders by payment method.',
    labels: ['Cash on delivery', 'bKash', 'Card', 'Nagad', 'Bank transfer'],
    series: [{ id: 's1', name: 'Orders', values: [46, 28, 14, 9, 3] }],
    show_values: 'all-small',
  }),
  chart('c_donut', {
    kind: 'donut',
    title: 'Revenue by branch',
    description: 'This quarter.',
    labels: ['Dhaka', 'Chattogram', 'Sylhet', 'Khulna'],
    series: [{ id: 's1', name: 'Revenue', values: [540000, 310000, 120000, 80000] }],
    unit: '৳',
    unit_position: 'before',
    show_values: 'all-small',
    show_table: true,
  }),
]

const payload = {
  document: { id: '01a1c9d9-0000-7000-8000-0000000000c6', key: 'home', title: 'Home', version: 1, source: 'published' },
  sections: CHARTS.map((el, i) => ({
    id: `s_${i}`,
    type: 'section',
    props: { layout: 'boxed', anchor: null },
    style: { base: { spacing: { padding: { top: '24px', bottom: '24px' } } } },
    visibility: VISIBLE,
    columns: [{ id: `col_${i}`, type: 'column', width: { base: 100 }, style: {}, elements: [el] }],
  })),
  media: {},
  data: {},
}

const bootstrap = {
  store: { name: 'Green Basket', description: 'Organic groceries', prices_include_tax: true, currency: 'BDT' },
  preview: false,
  builder: { home: true },
  theme: {
    colors: { primary: '#f59e0b', primary_foreground: '#3b2500', accent: '#6f55c2', accent_foreground: '#ffffff', highlight: '#2fb79a', sale: '#c2410c', heading: '#3d3d3d', text: '#5f6368', canvas: '#f3f7fa', surface: '#ffffff', border: '#e1e1e1' },
    typography: { heading_font: 'baloo', body_font: 'poppins' },
    shape: { button_style: 'pill', card_radius: 12 },
    layout: { container_width: 1170, sticky_header: true },
    logo: null,
    favicon: null,
    announcement: null,
    footer: { about: null, copyright: null, contact: { email: null, phone: null, address: null }, social: {}, payment_logos: [] },
    custom_css: null,
  },
  menus: {},
}

async function serveStore(page: Page) {
  await page.route('**/api/v1/store/bootstrap*', (route) => route.fulfill({ json: envelope(bootstrap) }))
  await page.route('**/api/v1/store/builder/pages/home*', (route) => route.fulfill({ json: envelope(payload) }))
  await page.route('**/api/v1/store/homepage*', (route) => route.fulfill({ json: envelope({ sections: [], preview: false }) }))
  await page.route('**/api/v1/store/account/me*', (route) => route.fulfill({ json: envelope(null) }))
  await page.route('**/api/v1/store/wishlist*', (route) => route.fulfill({ json: envelope({ items: [] }) }))
  await page.route('**/api/v1/store/cart*', (route) =>
    route.fulfill({ json: envelope({ id: null, items: [], item_count: '0', subtotal: '0.00', discount_total: '0.00', tax_total: '0.00', total: '0.00', prices_include_tax: true, currency: 'BDT', issues: [], promotions: [], free_shipping: null, coupon: null }) }),
  )
}

/** Attached to the results; also written to $CHART_SHOTS (a folder) for a manual review. */
async function shot(testInfo: TestInfo, name: string, body: Buffer) {
  await testInfo.attach(name, { body, contentType: 'image/png' })
  const dir = process.env.CHART_SHOTS
  if (dir) {
    mkdirSync(dir, { recursive: true })
    writeFileSync(`${dir}/${name}-${testInfo.project.name}.png`, body)
  }
}

const figure = (page: Page, id: string) => page.locator(`[data-b="${id}"]`)

/*
 * Browser-side checks as source strings (the e2e project has no DOM types): text boxes in a chart's
 * drawing that overlap each other (rotated axis labels are checked by spacing instead).
 */
const COLLISIONS = (id: string) => `(() => {
  const svg = document.querySelector('[data-b="${id}"] svg[role="img"]')
  const boxes = Array.from(svg.querySelectorAll('text'))
    .filter((t) => !t.getAttribute('transform') && t.textContent)
    .map((t) => ({ text: t.textContent, r: t.getBoundingClientRect() }))
  const out = []
  boxes.forEach((a, i) => boxes.slice(i + 1).forEach((b) => {
    const overlap = a.r.left < b.r.right - 0.5 && b.r.left < a.r.right - 0.5 && a.r.top < b.r.bottom - 0.5 && b.r.top < a.r.bottom - 0.5
    if (overlap) out.push(a.text + ' x ' + b.text)
  }))
  const rotated = Array.from(svg.querySelectorAll('text[transform]')).map((t) => Number(t.getAttribute('x')))
  rotated.slice(1).forEach((x, i) => { if (x - rotated[i] < 17) out.push('rotated labels ' + i + ' and ' + (i + 1) + ' too close') })
  return out
})()`

const collisions = (page: Page, id: string) => page.evaluate<string[]>(COLLISIONS(id))

async function noHorizontalScroll(page: Page) {
  const { scroll, inner } = await page.evaluate<{ scroll: number; inner: number }>('({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth })')
  expect(scroll).toBeLessThanOrEqual(inner)
}

async function checkAllKinds(page: Page, width: number, testInfo: TestInfo) {
  for (const el of CHARTS) {
    const fig = figure(page, el.id)
    await fig.scrollIntoViewIfNeeded()
    const svg = fig.getByTestId('chart-svg')
    await expect(svg).toBeVisible()
    await expect(svg).toHaveAttribute('role', 'img')
    await expect(svg).toHaveAccessibleName(new RegExp(String(el.props.title)))
    const box = (await fig.locator('svg[role="img"]').boundingBox())!
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(width)
    expect(await collisions(page, el.id)).toEqual([])
    await expect(fig.locator('[data-viz-mark]').first()).toBeAttached()
    await shot(testInfo, `${String((el.props as Record<string, unknown>).kind)}-${width}`, await fig.screenshot())
  }
  await noHorizontalScroll(page)
}

/** The tooltip of a chart, inside the chart's own box. */
async function tooltipInside(fig: Locator, text: RegExp) {
  const tip = fig.getByRole('tooltip')
  await expect(tip).toBeVisible()
  await expect(tip).toHaveText(text)
  const t = (await tip.boundingBox())!
  const f = (await fig.boundingBox())!
  expect(t.x).toBeGreaterThanOrEqual(f.x - 1)
  expect(t.x + t.width).toBeLessThanOrEqual(f.x + f.width + 1)
}

test('charts at 1366 px: every kind, tooltips, keyboard and the data table', async ({ page, isMobile }, testInfo) => {
  test.skip(isMobile, 'desktop layout')
  await page.setViewportSize({ width: 1366, height: 900 })
  await serveStore(page)
  await page.goto('/')
  await checkAllKinds(page, 1366, testInfo)

  // Column: hover a bar → its tooltip (value first, then series name).
  const column = figure(page, 'c_column')
  await column.scrollIntoViewIfNeeded()
  const columnPoints = column.getByRole('group', { name: /Data points/ }).getByRole('img')
  await expect(columnPoints).toHaveCount(12)
  await columnPoints.nth(0).hover()
  await tooltipInside(column, /Jan৳120,000Sales/)
  // Keyboard: focus a mark, arrows move, the same tooltip follows.
  await columnPoints.nth(0).focus()
  await page.keyboard.press('ArrowRight')
  await expect(columnPoints.nth(1)).toBeFocused()
  await tooltipInside(column, /Jan৳80,000Costs/)
  await expect(column.getByTestId('chart-focus-ring')).toBeVisible()
  // Tab leaves the chart in one step (one tab stop for all marks).
  await page.keyboard.press('Tab')
  await expect(column.getByRole('button', { name: 'Show data table' })).toBeFocused()

  // Line: one stop per month with a crosshair; direct end labels with the last values; legend kept.
  const line = figure(page, 'c_line')
  await line.scrollIntoViewIfNeeded()
  await expect(line.getByTestId('chart-end-label')).toHaveCount(3)
  await expect(line.getByTestId('chart-legend')).toBeVisible()
  const linePoints = line.getByRole('group', { name: /Data points/ }).getByRole('img')
  await expect(linePoints).toHaveCount(12)
  await linePoints.nth(5).hover()
  await expect(line.getByTestId('chart-crosshair')).toBeAttached()
  await tooltipInside(line, /Jun510Online480In store145Phone/)

  // Bar: long names truncated, values at the bar tips.
  const bar = figure(page, 'c_bar')
  await bar.scrollIntoViewIfNeeded()
  await expect(bar.getByTestId('chart-value-label')).toHaveCount(6)
  await expect(bar.getByTestId('chart-value-label').first()).toHaveText('940 pcs')

  // Pie: slices with shares; the table toggles visibly but is always in the DOM.
  const pie = figure(page, 'c_pie')
  await pie.scrollIntoViewIfNeeded()
  await expect(pie.getByRole('table')).toBeAttached()
  await expect(pie.getByTestId('chart-table')).toHaveClass(/sr-only/)
  await pie.getByRole('button', { name: 'Show data table' }).click()
  await expect(pie.getByRole('table')).toBeVisible()
  await expect(pie.getByRole('row', { name: /bKash 28 28%/ })).toBeVisible()
  const piePoints = pie.getByRole('group', { name: /Data points/ }).getByRole('img')
  await piePoints.nth(1).hover()
  await tooltipInside(pie, /bKash2828%Orders/)

  // Donut: total in the middle, table shown from the start (show_table).
  const donut = figure(page, 'c_donut')
  await donut.scrollIntoViewIfNeeded()
  await expect(donut.getByTestId('chart-donut-total')).toHaveText('৳1,050,000')
  await expect(donut.getByRole('table')).toBeVisible()

  await shot(testInfo, 'page-1366', await page.screenshot({ fullPage: true }))

  // Texture (identity without hue) only for print and forced colours: off on screen, on in print / forced-colors.
  const fillOf = () => page.evaluate<string>(`getComputedStyle(document.querySelector('[data-b="c_column"] [data-viz-mark="bar"]')).fill`)
  expect(await fillOf()).toMatch(/^rgb/)
  await page.emulateMedia({ media: 'print' })
  expect(await fillOf()).toMatch(/^url\(/)
  await page.emulateMedia({ media: 'screen', forcedColors: 'active' })
  expect(await fillOf()).toMatch(/^url\(/)
  await column.scrollIntoViewIfNeeded()
  await shot(testInfo, 'column-forced-colors', await column.screenshot())
  await page.emulateMedia({ media: 'screen', forcedColors: 'none' })
})

test('charts at 375 px: no horizontal scroll, labels fit, tap shows the tooltip', async ({ page, isMobile }, testInfo) => {
  await page.setViewportSize({ width: 375, height: 800 })
  await serveStore(page)
  await page.goto('/')
  await checkAllKinds(page, 375, testInfo)

  // The 24-day area chart thins its rotated labels instead of colliding.
  const area = figure(page, 'c_area')
  const drawn = await area.getByTestId('chart-category').count()
  expect(drawn).toBeGreaterThan(1)
  expect(drawn).toBeLessThan(24)
  // Line end labels need room: on a phone identity falls back to the legend.
  const line = figure(page, 'c_line')
  await expect(line.getByTestId('chart-end-label')).toHaveCount(0)
  await expect(line.getByTestId('chart-legend')).toBeVisible()

  const column = figure(page, 'c_column')
  await column.scrollIntoViewIfNeeded()
  const last = column.getByRole('group', { name: /Data points/ }).getByRole('img').last()
  if (isMobile) await last.tap()
  else await last.click()
  await tooltipInside(column, /Jun৳140,000Costs/)
  // A tap elsewhere hides it.
  if (isMobile) await column.locator('figcaption').tap()
  else await column.locator('figcaption').click()
  await expect(column.getByRole('tooltip')).toHaveCount(0)
  await noHorizontalScroll(page)
  await shot(testInfo, `page-375-${testInfo.project.name}`, await page.screenshot({ fullPage: true }))
})
