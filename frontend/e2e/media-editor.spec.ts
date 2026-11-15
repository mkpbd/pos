import { expect, test, type Page, type Request } from '@playwright/test'

/**
 * B11 picture tools against a mocked API: crop with a fixed shape and the keyboard, turn,
 * light, focal point → saved as a new copy; focal point only → PATCH; replacing a picture in
 * use asks first. Runs on desktop and mobile.
 */

const envelope = (data: unknown, meta: Record<string, unknown> = {}) => ({ success: true, data, meta: { request_id: 'e2e', ...meta } })
const page1 = (items: unknown[]) => envelope(items, { pagination: { current_page: 1, per_page: 24, total: items.length, last_page: 1 } })

// 1×1 PNG, served for every library file (the editor works on the item's real size, 1600 × 900).
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64')

const me = {
  user: { id: 'u-1', name: 'Nadia Admin', email: 'nadia@berry.test', phone: null, is_platform_admin: false, last_login_at: null },
  organization: { id: 'o-1', name: 'Berry Kids', slug: 'berry-kids', base_currency: 'BDT', timezone: 'Asia/Dhaka', tax_mode: 'exclusive', status: 'active' },
  roles: [{ id: 'r-1', name: 'Organization Admin', system_key: 'organization_admin' }],
  permissions: ['branches.view', 'media.manage', 'storefront.view', 'storefront.manage'],
  branches: [{ id: 'b-1', code: 'MAIN', name: 'Main Branch', is_active: true }],
}

const hero = {
  id: 'm-1', url: '/storage/media/o-1/m-1.jpg', srcset: '/storage/media/o-1/m-1-320.webp 320w, /storage/media/o-1/m-1.jpg 1600w',
  width: 1600, height: 900, alt: 'Children playing', focal: null, edited_from_id: null, original_name: 'hero.jpg', mime_type: 'image/jpeg', size: 420_000, created_at: null,
}

async function mockBackend(page: Page, usage: { in_use: boolean; places: string[] } = { in_use: false, places: [] }) {
  await page.route('**/sanctum/csrf-cookie', (route) => route.fulfill({ status: 204, headers: { 'Set-Cookie': 'XSRF-TOKEN=e2e; Path=/' } }))
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({ json: envelope(me) }))
  await page.route('**/api/v1/notifications/unread-count', (route) => route.fulfill({ json: envelope({ count: 0 }) }))
  await page.route('**/storage/media/**', (route) => route.fulfill({ contentType: 'image/png', body: PNG }))
  await page.route('**/api/v1/media?*', (route) => route.fulfill({ json: page1([hero]) }))
  await page.route('**/api/v1/media/m-1/usage', (route) => route.fulfill({ json: envelope(usage) }))
  await page.route('**/api/v1/media/m-1/edit', (route) => {
    const input = route.request().postDataJSON() as { mode: string }
    return input.mode === 'replace'
      ? route.fulfill({ json: envelope({ ...hero, width: 900, height: 900 }) })
      : route.fulfill({ status: 201, json: envelope({ ...hero, id: 'm-2', original_name: 'hero (edited).jpg', width: 900, height: 900, edited_from_id: 'm-1' }) })
  })
  await page.route('**/api/v1/media/m-1', (route) => {
    const input = route.request().postDataJSON() as { focal_x: number | null; focal_y: number | null }
    return route.fulfill({ json: envelope({ ...hero, focal: input.focal_x === null ? null : { x: input.focal_x, y: input.focal_y } }) })
  })
}

async function openEditor(page: Page) {
  await page.goto('/admin/media')
  await page.getByRole('button', { name: 'Edit picture hero.jpg' }).click()
  const dialog = page.getByRole('dialog', { name: 'Edit picture' })
  await expect(dialog).toBeVisible()
  return dialog
}

test('crops to a square with the keyboard, turns, brightens, sets the focal point and saves a copy', async ({ page }) => {
  await mockBackend(page)
  const dialog = await openEditor(page)

  await dialog.getByRole('button', { name: 'Square 1:1' }).click()
  await expect(dialog.getByRole('button', { name: 'Square 1:1' })).toHaveAttribute('aria-pressed', 'true')
  const box = dialog.getByRole('group', { name: /Crop area, 900 × 900 pixels/ })
  await box.focus()
  // One step = 1 % of the longer side (16 px).
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')

  await dialog.getByRole('tab', { name: 'Turn and flip' }).click()
  await dialog.getByRole('button', { name: 'Turn right' }).click()
  await expect(dialog.getByText('Result: 900×900 px')).toBeVisible()

  await dialog.getByRole('tab', { name: 'Light and colour' }).click()
  await dialog.getByLabel('Brightness').fill('20')
  await expect(dialog.getByRole('img', { name: 'Children playing' })).toHaveCSS('filter', 'brightness(1.2) contrast(1) saturate(1)')

  await dialog.getByRole('tab', { name: 'Focal point' }).click()
  const stage = dialog.getByTestId('editor-stage')
  const size = await stage.boundingBox()
  await stage.click({ position: { x: size!.width / 2, y: size!.height / 2 } })
  await expect(dialog.getByText(/^5\d% across|^4\d% across/)).toBeVisible()

  const posted = page.waitForRequest((r: Request) => r.url().endsWith('/api/v1/media/m-1/edit'))
  await dialog.getByRole('button', { name: 'Save copy' }).click()
  const body = (await posted).postDataJSON() as Record<string, number | boolean | string | Record<string, number>>
  expect(body).toMatchObject({ crop: { x: 382, y: 0, w: 900, h: 900 }, rotate: 90, flip_h: false, flip_v: false, brightness: 20, contrast: 0, saturation: 0, mode: 'copy' })
  expect(Number(body.focal_x)).toBeGreaterThanOrEqual(45)
  expect(Number(body.focal_x)).toBeLessThanOrEqual(55)
  await expect(page.getByText('Edited copy saved as hero (edited).jpg.')).toBeVisible()
  await expect(dialog).toBeHidden()
})

test('moves the focal point with the keyboard and saves only the point', async ({ page }) => {
  await mockBackend(page)
  const dialog = await openEditor(page)
  await dialog.getByRole('tab', { name: 'Focal point' }).click()
  const marker = dialog.getByRole('slider', { name: 'Focal point' })
  await marker.focus()
  // Starts at the centre: Shift moves by 10 %.
  await page.keyboard.press('Shift+ArrowLeft')
  await page.keyboard.press('Shift+ArrowUp')
  await page.keyboard.press('ArrowUp')
  await expect(marker).toHaveAttribute('aria-valuetext', '40% across, 39% down')

  const patched = page.waitForRequest((r: Request) => r.url().endsWith('/api/v1/media/m-1') && r.method() === 'PATCH')
  await dialog.getByRole('button', { name: 'Save focal point' }).click()
  expect((await patched).postDataJSON()).toEqual({ focal_x: 40, focal_y: 39 })
  await expect(page.getByText('Focal point saved.')).toBeVisible()
})

test('replacing a picture in use lists the places and needs a confirmation', async ({ page }) => {
  await mockBackend(page, { in_use: true, places: ['Store builder pages, versions or templates', 'Banners'] })
  const dialog = await openEditor(page)
  await dialog.getByRole('tab', { name: 'Turn and flip' }).click()
  await dialog.getByRole('button', { name: 'Mirror' }).click()
  await dialog.getByRole('radio', { name: /Replace the original/ }).check()
  await expect(dialog.getByText('Banners')).toBeVisible()
  const replace = dialog.getByRole('button', { name: 'Replace picture' })
  await expect(replace).toBeDisabled()
  await dialog.getByRole('checkbox', { name: 'Replace it in these places too' }).click()

  const posted = page.waitForRequest((r: Request) => r.url().endsWith('/api/v1/media/m-1/edit'))
  await replace.click()
  expect((await posted).postDataJSON()).toMatchObject({ flip_h: true, mode: 'replace', confirm_replace: true })
  await expect(page.getByText('Picture replaced everywhere it is used.')).toBeVisible()
})
