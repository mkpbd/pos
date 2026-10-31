import { describe, expect, it } from 'vitest'
import { loginPathFor, safeNextPath } from './safe-next'

describe('safe ?next= redirects', () => {
  it('accepts relative paths on this storefront, with query and hash', () => {
    expect(safeNextPath('/account/addresses')).toBe('/account/addresses')
    expect(safeNextPath('/product/kids-tee?variant=v-1#reviews')).toBe('/product/kids-tee?variant=v-1#reviews')
    expect(safeNextPath('/cart')).toBe('/cart')
    // Encoded characters stay encoded inside the path: harmless, and still on this site.
    expect(safeNextPath('/%2F%2Fevil.test')).toBe('/%2F%2Fevil.test')
  })

  it.each([
    null,
    '',
    'account',
    'https://evil.test/',
    '//evil.test',
    '///evil.test',
    '/\\evil.test',
    '\\\\evil.test',
    'javascript:alert(1)',
    '/ok\nhttps://evil.test',
    '/\tevil',
    '/admin/settings',
    '/api/v1/store/cart',
    '/sanctum/csrf-cookie',
    '/storage/x.png',
  ])('refuses %j', (raw) => {
    expect(safeNextPath(raw)).toBeNull()
  })

  it('builds the sign-in path for a protected page', () => {
    expect(loginPathFor('/account/addresses')).toBe('/account/login?next=%2Faccount%2Faddresses')
    expect(loginPathFor('/account')).toBe('/account/login')
    expect(loginPathFor('//evil.test')).toBe('/account/login')
  })
})
