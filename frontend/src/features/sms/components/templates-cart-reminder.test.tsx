import { screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { routes } from '@/app/routes'
import type { SmsTemplates } from '@/features/sms/api'
import { defaultTemplates, paged, SMS_ADMIN, smsMessage, smsSettings } from '@/features/sms/test-data'
import { mockApi, ok, renderRoutes } from '@/test/utils'

/* BD2b §4: Settings → SMS lists the "Cart reminder" template (when the server has it) with {shop} {name} {link}. */

const cartReminder = { enabled: true, en: '{shop}: Hi {name}, you left something in your cart. Complete your order: {link}', bn: '{shop}: প্রিয় {name}, আপনার কার্টে কিছু পণ্য রয়ে গেছে। {link}' }
const withReminder = (): SmsTemplates => ({ ...defaultTemplates(), cart_reminder: cartReminder })

describe('SMS → Cart reminder template', () => {
  beforeEach(() => {
    document.cookie = 'XSRF-TOKEN=t'
  })

  it('shows the cart reminder with {shop} {name} {link} and names it in the log', async () => {
    mockApi({
      'GET /auth/me': ok(SMS_ADMIN()),
      'GET /sms/settings': ok(smsSettings({ templates: withReminder(), default_templates: withReminder() })),
      'GET /sms/messages': ok([smsMessage({ purpose: 'cart_reminder', related: null })], paged(1)),
    })
    renderRoutes(routes, '/settings/sms')

    const card = (await screen.findByRole('heading', { name: 'Message templates' })).closest('[data-slot=card]') as HTMLElement
    const reminder = within(card).getByTestId('template-cart_reminder')
    expect(within(reminder).getByRole('heading', { name: 'Cart reminder' })).toBeInTheDocument()
    expect(within(reminder).getByRole('switch', { name: 'Send “Cart reminder”' })).toBeChecked()
    expect(within(reminder).getAllByRole('button', { name: /^Insert \{/ }).map((b) => b.textContent)).toEqual(['{shop}', '{name}', '{link}'])
    expect(await screen.findByText('Cart reminder', { selector: 'td *, td' })).toBeInTheDocument()
  })
})
