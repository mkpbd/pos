import { expect, test, type Page, type Request } from '@playwright/test'

/**
 * E12b admin: Bangla content translations and the store's language settings, against a
 * mocked API (desktop and mobile projects).
 */
const envelope = (data: unknown, meta: Record<string, unknown> = {}) => ({ success: true, data, meta: { request_id: 'e2e', ...meta } })
const page1 = (items: unknown[]) => envelope(items, { pagination: { current_page: 1, per_page: 25, total: items.length, last_page: 1 } })
const failure = (code: string, message: string, details: Record<string, unknown> = {}) => ({ success: false, error: { code, message, details }, meta: { request_id: 'e2e' } })

const me = {
  user: { id: 'u-1', name: 'Nadia Store', email: 'nadia@berry.test', phone: null, is_platform_admin: false, last_login_at: null },
  organization: { id: 'o-1', name: 'Berry Kids', slug: 'berry-kids', base_currency: 'BDT', timezone: 'Asia/Dhaka', tax_mode: 'exclusive', status: 'active' },
  roles: [{ id: 'r-9', name: 'Online Store Manager', system_key: 'online_store_manager' }],
  permissions: ['branches.view', 'media.manage', 'storefront.manage', 'storefront.view', 'cms.manage'],
  branches: [{ id: 'b-1', code: 'MAIN', name: 'Main Branch', is_active: true }],
}

const cmsPage = {
  id: 'p-1', slug: 'about-us', title: 'About us', template: 'default', status: 'published', is_visible: true, published_at: null,
  seo_title: null, seo_description: null, updated_at: null, body_html: '<p>We sell kids’ clothes.</p>',
  translations: { bn: { title: 'আমাদের কথা' } },
}

const banner = {
  id: 'bn-1', placement: 'hero_slider', name: 'Eid sale', kicker: null, title: 'Flat 20% off', subtitle: null, link_url: '/sale', button_label: 'Shop now',
  secondary_link_url: null, secondary_button_label: null, desktop_media_id: 'media-1', mobile_media_id: null, text_color: '#ffffff', text_position: 'left',
  starts_at: null, ends_at: null, is_active: true, is_live: true, state: 'live', sort_order: 0, updated_at: null, translations: null,
}

async function mockBackend(page: Page) {
  await page.route('**/sanctum/csrf-cookie', (route) => route.fulfill({ status: 204, headers: { 'Set-Cookie': 'XSRF-TOKEN=e2e; Path=/' } }))
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({ json: envelope(me) }))
  await page.route('**/api/v1/branches?*', (route) => route.fulfill({ json: page1([]) }))
  await page.route('**/api/v1/notifications/unread-count', (route) => route.fulfill({ json: envelope({ count: 0 }) }))
  await page.route('**/api/v1/media?*', (route) => route.fulfill({ json: page1([]) }))
}

test('translates a content page into Bangla and shows the server’s error on the Bangla field', async ({ page }) => {
  await mockBackend(page)
  let patches = 0
  await page.route('**/api/v1/cms/pages/p-1', (route) => {
    if (route.request().method() !== 'PATCH') return route.fulfill({ json: envelope(cmsPage) })
    patches += 1
    return patches === 1
      ? route.fulfill({ status: 422, json: failure('VALIDATION_FAILED', 'The given data was invalid.', { 'translations.bn.seo_title': ['The Bangla SEO title may not be greater than 160 characters.'] }) })
      : route.fulfill({ json: envelope({ ...cmsPage, translations: route.request().postDataJSON().translations }) })
  })
  await page.goto('/admin/content/pages/p-1')

  const section = page.getByRole('region', { name: /বাংলা \(Bangla\)/ })
  await expect(section.getByRole('button', { name: /বাংলা \(Bangla\)/ })).toHaveAttribute('aria-expanded', 'true')
  const title = section.getByLabel('Title in Bangla', { exact: true })
  await expect(title).toHaveValue('আমাদের কথা')
  await expect(title).toHaveAttribute('lang', 'bn')
  await expect(title).toHaveAttribute('placeholder', 'About us')
  await expect(section.getByRole('textbox', { name: 'Page text in Bangla' })).toHaveAttribute('lang', 'bn')
  await expect(section.getByText('Leave a field empty to show the English text.', { exact: false })).toBeVisible()

  await section.getByLabel('SEO title in Bangla', { exact: true }).fill('আমাদের সম্পর্কে জানুন')
  const first = page.waitForRequest((r: Request) => r.url().endsWith('/api/v1/cms/pages/p-1') && r.method() === 'PATCH')
  await page.getByRole('button', { name: 'Save page' }).click()
  expect((await first).postDataJSON().translations).toEqual({ bn: { title: 'আমাদের কথা', body_html: '', seo_title: 'আমাদের সম্পর্কে জানুন', seo_description: '' } })
  await expect(section.getByText('The Bangla SEO title may not be greater than 160 characters.')).toBeVisible()
  await expect(section.getByLabel('SEO title in Bangla', { exact: true })).toHaveAttribute('aria-invalid', 'true')

  await section.getByLabel('SEO title in Bangla', { exact: true }).fill('আমাদের সম্পর্কে')
  const second = page.waitForRequest((r: Request) => r.url().endsWith('/api/v1/cms/pages/p-1') && r.method() === 'PATCH')
  await page.getByRole('button', { name: 'Save page' }).click()
  expect((await second).postDataJSON().translations.bn.seo_title).toBe('আমাদের সম্পর্কে')
  await expect(page.getByText('Page saved.')).toBeVisible()
})

test('adds Bangla texts to a hero banner', async ({ page }) => {
  await mockBackend(page)
  await page.route('**/api/v1/storefront/banners', (route) => route.fulfill({ json: envelope([banner]) }))
  await page.route('**/api/v1/storefront/banners/bn-1', (route) => route.fulfill({ json: envelope({ ...banner, ...route.request().postDataJSON() }) }))
  await page.goto('/admin/storefront/banners')

  await page.getByRole('button', { name: 'Edit Eid sale' }).click()
  const dialog = page.getByRole('dialog', { name: 'Edit banner' })
  const toggle = dialog.getByRole('button', { name: /বাংলা \(Bangla\)/ })
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await toggle.click()
  await expect(dialog.getByLabel('Headline in Bangla', { exact: true })).toHaveAttribute('placeholder', 'Flat 20% off')
  await dialog.getByLabel('Headline in Bangla', { exact: true }).fill('ফ্ল্যাট ২০% ছাড়')
  await dialog.getByLabel('Button label in Bangla', { exact: true }).fill('এখনই কিনুন')
  await expect(toggle).toContainText('2 of 5 translated')

  const patch = page.waitForRequest((r: Request) => r.url().endsWith('/api/v1/storefront/banners/bn-1') && r.method() === 'PATCH')
  await dialog.getByRole('button', { name: 'Save banner' }).click()
  expect((await patch).postDataJSON().translations).toEqual({ bn: { kicker: '', title: 'ফ্ল্যাট ২০% ছাড়', subtitle: '', button_label: 'এখনই কিনুন', secondary_button_label: '' } })
  await expect(page.getByText('Banner saved.')).toBeVisible()
})

test('sets the store languages', async ({ page }) => {
  await mockBackend(page)
  let settings = { is_enabled: true, site_name: 'Berry Kids', meta_description: null, fulfilment_store_id: null, updated_at: null, bangla_enabled: true, default_locale: 'en', bangla_digits: false }
  await page.route('**/api/v1/storefront/settings', (route) => {
    if (route.request().method() === 'PATCH') settings = { ...settings, ...route.request().postDataJSON() }
    return route.fulfill({ json: envelope(settings) })
  })
  await page.route('**/api/v1/storefront/domains', (route) => route.fulfill({ json: envelope([]) }))
  await page.goto('/admin/storefront')

  const bangla = page.getByRole('switch', { name: 'Offer the store in Bangla' })
  const language = page.getByRole('combobox', { name: 'Default language' })
  await expect(bangla).toBeChecked()
  await expect(language).toContainText('English')

  let patch = page.waitForRequest((r: Request) => r.url().endsWith('/api/v1/storefront/settings') && r.method() === 'PATCH')
  await language.click()
  await page.getByRole('option', { name: 'বাংলা (Bangla)' }).click()
  expect((await patch).postDataJSON()).toEqual({ default_locale: 'bn' })
  await expect(language).toContainText('বাংলা (Bangla)')

  patch = page.waitForRequest((r: Request) => r.url().endsWith('/api/v1/storefront/settings') && r.method() === 'PATCH')
  await page.getByRole('switch', { name: 'Bengali digits in Bangla' }).click()
  expect((await patch).postDataJSON()).toEqual({ bangla_digits: true })

  // Turning Bangla off moves the default back to English and locks the Bangla-only options.
  patch = page.waitForRequest((r: Request) => r.url().endsWith('/api/v1/storefront/settings') && r.method() === 'PATCH')
  await bangla.click()
  expect((await patch).postDataJSON()).toEqual({ bangla_enabled: false, default_locale: 'en' })
  await expect(language).toContainText('English')
  await expect(page.getByRole('switch', { name: 'Bengali digits in Bangla' })).toBeDisabled()
  await expect(page.getByText('Turn on Bangla to make it the default language.')).toBeVisible()
})
