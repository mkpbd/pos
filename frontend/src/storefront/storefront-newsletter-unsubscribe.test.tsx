import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { fail, mockApi, ok, renderRoutes } from '@/test/utils'
import { storefrontRoutes } from './routes'
import { bilingualBootstrap, bootstrapFixture, resetLocale } from './test-fixtures'

/* BD2b §4: the signed unsubscribe link of newsletter campaign e-mails, in English and Bangla. */

const SUBSCRIBER = '9b2f6c1e-0000-4000-8000-000000000001'
const PATH = `POST /store/newsletter/unsubscribe/${SUBSCRIBER}`
const link = (extra = '') => `/newsletter/unsubscribe?subscriber=${SUBSCRIBER}&signature=abc123${extra}`

afterEach(resetLocale)

describe('signed newsletter unsubscribe link', () => {
  it('unsubscribes after a click, sending only the signature', async () => {
    const urls: URL[] = []
    mockApi({
      'GET /store/bootstrap': ok(bootstrapFixture()),
      [PATH]: (_init, url) => {
        urls.push(url)
        return ok({ message: 'You have been unsubscribed.', already_unsubscribed: false })
      },
    })
    renderRoutes(storefrontRoutes, link())
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Unsubscribe' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Unsubscribed' })).toBeInTheDocument()
    expect(screen.getByText('You will no longer receive our newsletter.')).toHaveAttribute('role', 'status')
    // The signature covers the query: no `lang` may be added.
    expect(urls).toHaveLength(1)
    expect([...urls[0]!.searchParams.entries()]).toEqual([['signature', 'abc123']])
  })

  it('says so in Bangla when the address was already unsubscribed', async () => {
    mockApi({
      'GET /store/bootstrap': ok(bilingualBootstrap()),
      [PATH]: ok({ message: 'You have been unsubscribed.', already_unsubscribed: true }),
    })
    renderRoutes(storefrontRoutes, link('&lang=bn'))
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'আনসাবস্ক্রাইব করুন' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'আপনি আগেই আনসাবস্ক্রাইব করেছেন' })).toBeInTheDocument()
    expect(screen.getByText('এই ঠিকানায় আমাদের নিউজলেটার আর পাঠানো হয় না।')).toHaveAttribute('role', 'status')
    expect(screen.getByRole('link', { name: 'কেনাকাটা চালিয়ে যান' })).toHaveAttribute('href', '/')
  })

  it('shows the error of a tampered link', async () => {
    mockApi({
      'GET /store/bootstrap': ok(bootstrapFixture()),
      [PATH]: fail(422, 'TOKEN_INVALID', 'This unsubscribe link is invalid.'),
    })
    renderRoutes(storefrontRoutes, link())
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Unsubscribe' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/invalid/i)
    expect(screen.getByRole('heading', { level: 1, name: 'Unsubscribe from the newsletter' })).toBeInTheDocument()
  })
})
