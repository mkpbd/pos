import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { routes } from '@/app/routes'
import type { SmsTemplates } from '@/features/sms/api'
import { defaultTemplates, paged, SMS_ADMIN, smsMessage, smsSettings } from '@/features/sms/test-data'
import { mockApi, ok, renderRoutes } from '@/test/utils'

/* R1 §4: Settings → SMS lists the "Due reminder" template (when the server has it) with {shop} {name} {due} {link}. */

const dueReminder = { enabled: true, en: '{shop}: Dear {name}, you owe Tk {due}. Please pay at your convenience. {link}', bn: '{shop}: {name}, আপনার বাকি ৳{due}। {link}' }
const withReminder = (): SmsTemplates => ({ ...defaultTemplates(), due_reminder: dueReminder })
const PLACEHOLDERS = ['shop', 'name', 'order', 'invoice', 'due', 'total', 'link', 'courier', 'tracking', 'tracking_link']

const templatesCard = async () => (await screen.findByRole('heading', { name: 'Message templates' })).closest('[data-slot=card]') as HTMLElement

describe('SMS → Due reminder template', () => {
  beforeEach(() => {
    document.cookie = 'XSRF-TOKEN=t'
  })

  it('shows the due reminder with {due} and saves it with the others', async () => {
    const user = userEvent.setup()
    const patches: { templates: SmsTemplates }[] = []
    mockApi({
      'GET /auth/me': ok(SMS_ADMIN()),
      'GET /sms/settings': ok(smsSettings({ templates: withReminder(), default_templates: withReminder(), placeholders: PLACEHOLDERS })),
      'GET /sms/messages': ok([smsMessage({ purpose: 'due_reminder', related: { type: 'customer', id: 'c-1' } })], paged(1)),
      'PATCH /sms/settings': (init) => {
        const body = JSON.parse(String(init.body)) as { templates: SmsTemplates }
        patches.push(body)
        return ok(smsSettings({ templates: body.templates, default_templates: withReminder(), placeholders: PLACEHOLDERS }))
      },
    })
    renderRoutes(routes, '/settings/sms')

    const card = await templatesCard()
    const reminder = within(card).getByTestId('template-due_reminder')
    expect(within(reminder).getByRole('heading', { name: 'Due reminder' })).toBeInTheDocument()
    expect(within(reminder).getByRole('switch', { name: 'Send “Due reminder”' })).toBeChecked()
    const chips = within(reminder).getAllByRole('button', { name: /^Insert \{/ }).map((b) => b.textContent)
    expect(chips).toEqual(['{shop}', '{name}', '{due}', '{link}'])
    // The order templates offer neither {due} nor {invoice}.
    expect(within(within(card).getByTestId('template-order_placed')).queryByRole('button', { name: /Insert \{due\}/ })).not.toBeInTheDocument()
    expect(within(reminder).getByTestId('template-due_reminder-en-count')).toHaveTextContent(/characters · 1 SMS · GSM with example values/)

    await user.click(within(reminder).getByRole('switch', { name: 'Send “Due reminder”' }))
    await user.click(within(card).getByRole('button', { name: 'Save templates' }))
    await waitFor(() => expect(patches).toHaveLength(1))
    expect(patches[0]?.templates.due_reminder).toEqual({ ...dueReminder, enabled: false })

    // The message log names the purpose.
    expect(await screen.findByText('Due reminder', { selector: 'td *, td' })).toBeInTheDocument()
  })

  it('leaves it out when the server has no due reminder template', async () => {
    mockApi({
      'GET /auth/me': ok(SMS_ADMIN()),
      'GET /sms/settings': ok(smsSettings()),
      'GET /sms/messages': ok([], paged(0)),
    })
    renderRoutes(routes, '/settings/sms')
    const card = await templatesCard()
    expect(within(card).getByTestId('template-order_placed')).toBeInTheDocument()
    expect(within(card).queryByTestId('template-due_reminder')).not.toBeInTheDocument()
  })
})
