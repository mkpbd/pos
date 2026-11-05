import { expect, test, type Page } from '@playwright/test'

/* E12b: a shopper switches the store to Bangla (mocked API; every /store/* request carries ?lang=). */

const envelope = (data: unknown) => ({ success: true, data, meta: { request_id: 'e2e' } })

const node = (id: string, label: string, url: string) => ({ id, label, url, open_in_new_tab: false, is_mega: false, mega_columns: null, image: null, children: [] })

/** Menu labels and the announcement come back translated, as the backend resolves them for `lang=bn`. */
function bootstrap(lang: string | null, options: { banglaDigits?: boolean } = {}) {
  const bn = lang === 'bn'
  return {
    store: { name: 'Berry Kids', description: 'Clothes and toys for little ones', prices_include_tax: true, currency: 'BDT', locales: ['en', 'bn'], default_locale: 'en', bangla_digits: options.banglaDigits ?? false },
    locale: bn ? 'bn' : 'en',
    preview: false,
    theme: {
      colors: {
        primary: '#f59e0b', primary_foreground: '#3b2500', accent: '#6f55c2', accent_foreground: '#ffffff', highlight: '#2fb79a',
        sale: '#c2410c', heading: '#3d3d3d', text: '#5f6368', canvas: '#f3f7fa', surface: '#ffffff', border: '#e1e1e1',
      },
      typography: { heading_font: 'baloo', body_font: 'poppins' },
      shape: { button_style: 'pill', card_radius: 12 },
      layout: { container_width: 1170, sticky_header: true },
      logo: null,
      favicon: null,
      announcement: { text: bn ? '৳2000-এর বেশি কেনাকাটায় ফ্রি ডেলিভারি' : 'Free delivery over ৳2000', link: null, background: '#2fb79a', foreground: '#062b22' },
      footer: { about: null, copyright: null, contact: { email: null, phone: null, address: null }, social: {}, payment_logos: [] },
      custom_css: null,
    },
    menus: { main: { name: 'Main', items: [node('n-1', bn ? 'ছেলেদের' : 'Boys', '/boys'), node('n-2', bn ? 'মেয়েদের' : 'Girls', '/girls')] } },
  }
}

const cart = { id: 'cart-1', items: [], item_count: '3', subtotal: '1350.00', discount_total: '0.00', tax_total: '0.00', total: '1350.00', prices_include_tax: true, currency: 'BDT', issues: [], promotions: [], free_shipping: null, coupon: null }

async function serveBilingualStore(page: Page, options: { banglaDigits?: boolean } = {}) {
  const requests: string[] = []
  await page.route(
    (url) => url.pathname.startsWith('/api/v1/store/'),
    (route) => {
      const url = new URL(route.request().url())
      const path = url.pathname.replace('/api/v1', '')
      const lang = url.searchParams.get('lang')
      requests.push(`${path} ${lang ?? '-'}`)
      switch (path) {
        case '/store/bootstrap':
          return route.fulfill({ json: envelope(bootstrap(lang, options)) })
        case '/store/homepage':
          return route.fulfill({ json: envelope({ sections: [], preview: false }) })
        case '/store/account/me':
          return route.fulfill({ json: envelope(null) })
        case '/store/cart':
          return route.fulfill({ json: envelope(cart) })
        default:
          return route.fulfill({ status: 404, json: { success: false, error: { code: 'NOT_FOUND', message: 'Not found', details: {} }, meta: { request_id: 'e2e' } } })
      }
    },
  )
  return requests
}

async function langCookie(page: Page) {
  return (await page.context().cookies()).find((cookie) => cookie.name === 'lang')
}

test('a shopper switches the store to Bangla and the choice sticks', async ({ page, isMobile }) => {
  const requests = await serveBilingualStore(page)
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1, name: 'Berry Kids' })).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')

  if (isMobile) {
    await page.getByRole('button', { name: 'Open menu' }).click()
    await page.getByRole('dialog').getByRole('group', { name: 'Language' }).getByRole('button', { name: 'বাংলা' }).click()
    await page.keyboard.press('Escape')
  } else {
    await page.getByRole('banner').getByRole('group', { name: 'Language' }).getByRole('button', { name: 'বাংলা' }).click()
  }

  await expect(page).toHaveURL(/\/\?lang=bn$/)
  await expect(page.locator('html')).toHaveAttribute('lang', 'bn')
  await expect(page.getByRole('link', { name: 'সাইন ইন' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'কার্ট, 3টি পণ্য' })).toBeVisible()
  await expect(page.getByTestId('announcement-bar')).toContainText('৳2000-এর বেশি কেনাকাটায় ফ্রি ডেলিভারি')
  expect(requests).toContain('/store/bootstrap bn')
  expect(requests).toContain('/store/cart bn')
  expect((await langCookie(page))?.value).toBe('bn')
  // Bengali text is set in Hind Siliguri.
  await expect(page.locator('html')).toHaveCSS('font-family', /Hind Siliguri/)

  // Next visit without ?lang=: the cookie keeps Bangla.
  await page.goto('/')
  await expect(page.getByRole('link', { name: 'সাইন ইন' })).toBeVisible()
  await expect(page).toHaveURL(/\/$/)
})

test('Bengali digits when the store turns them on', async ({ page }) => {
  await serveBilingualStore(page, { banglaDigits: true })
  await page.goto('/?lang=bn')

  await expect(page.getByRole('button', { name: 'কার্ট, ৩টি পণ্য' })).toBeVisible()
  await expect(page.getByTestId('cart-count')).toHaveText('৩')
})
