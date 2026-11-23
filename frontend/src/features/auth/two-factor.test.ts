import { describe, expect, it } from 'vitest'
import { groupKey, isSixDigitCode, sanitizeCode, serverMessage } from '@/features/auth/two-factor'
import { ApiError } from '@/lib/api/client'

describe('two-factor helpers (G1a)', () => {
  it('keeps digits only, at most six', () => {
    expect(sanitizeCode('123 456')).toBe('123456')
    expect(sanitizeCode('12a3-4567')).toBe('123456')
    expect(isSixDigitCode('123456')).toBe(true)
    expect(isSixDigitCode('12345')).toBe(false)
  })

  it('groups the setup key in fours', () => {
    expect(groupKey('JBSWY3DPEHPK3PXPJB')).toBe('JBSW Y3DP EHPK 3PXP JB')
    expect(groupKey('')).toBe('')
  })

  it('picks the field error of a validation failure, else the message', () => {
    const validation = new ApiError(422, 'VALIDATION_FAILED', 'The given data was invalid.', { code: ['The code must be 6 digits.'] })
    expect(serverMessage(validation, 'code')).toBe('The code must be 6 digits.')
    expect(serverMessage(validation, 'password')).toBe('The given data was invalid.')
    expect(serverMessage(new ApiError(422, 'INVALID_TWO_FACTOR_CODE', 'Wrong code.'), 'code')).toBe('Wrong code.')
    expect(serverMessage('nope')).toBe('Something went wrong.')
  })
})
