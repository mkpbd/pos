import type { Audience, AudienceRule } from '@/storefront/builder/audience/types'
import { audienceBadgeText, audienceProblems, clock, compareMoney, dayList, describeAudience, describeRule, freeKinds, newRule, parseValues, taka, toMoneyString } from './words'

const lookups = {
  districts: new Map([
    ['13', 'Dhaka'],
    ['15', 'Chattogram'],
  ]),
  campaigns: new Map([['c-1', 'Eid sale']]),
}

const audience = (rules: AudienceRule[], match: 'all' | 'any' = 'all'): Audience => ({ match, rules, otherwise: 'hide' })

describe('audience words', () => {
  it('says each rule in plain words', () => {
    expect(describeAudience(audience([{ kind: 'visitor', is: 'new' }]))).toBe('Only new visitors')
    expect(describeAudience(audience([{ kind: 'district', in: [13, 15] }]), lookups)).toBe('Only shoppers in Dhaka, Chattogram')
    expect(describeAudience(audience([{ kind: 'device', in: ['mobile'] }]))).toBe('Only on phones')
    expect(describeAudience(audience([{ kind: 'cart', min: '1500.00', max: null }]))).toBe('Only when the cart is ৳1,500 or more')
    expect(describeAudience(audience([{ kind: 'time', days: ['fri', 'sat'], from: '18:00', to: '23:00' }]))).toBe('Only 6 PM–11 PM on Fri, Sat')
    expect(describeRule({ kind: 'account', is: 'guest' })).toBe('guests (not signed in)')
    expect(describeRule({ kind: 'language', in: ['bn'] })).toBe('shoppers reading in Bangla')
    expect(describeRule({ kind: 'campaign', in: ['c-1'], utm_source: ['facebook'] }, lookups)).toBe('visitors from Eid sale or facebook')
    expect(describeRule({ kind: 'cart', min: '500.00', max: '1500.50' })).toBe('when the cart is ৳500–৳1,500.50')
    expect(describeRule({ kind: 'cart', max: '999.00' })).toBe('when the cart is ৳999 or less')
  })

  it('joins several rules with "and" (all) or "or" (any); no rules = everyone', () => {
    const rules: AudienceRule[] = [{ kind: 'visitor', is: 'returning' }, { kind: 'device', in: ['desktop', 'mobile'] }]
    expect(describeAudience(audience(rules))).toBe('Only returning visitors and on computers and phones')
    expect(describeAudience(audience(rules, 'any'))).toBe('Only returning visitors or on computers and phones')
    expect(describeAudience(null)).toBe('Everyone')
    expect(describeAudience(audience([]))).toBe('Everyone')
  })

  it('gives a short badge text', () => {
    expect(audienceBadgeText(null)).toBeNull()
    expect(audienceBadgeText(audience([{ kind: 'district', in: [13, 15] }]), lookups)).toBe('Dhaka +1')
    expect(audienceBadgeText(audience([{ kind: 'cart', min: '1500.00' }]))).toBe('Cart ≥ ৳1,500')
    expect(audienceBadgeText(audience([{ kind: 'device', in: ['mobile', 'tablet'] }]))).toBe('Tablet + Phone')
    expect(audienceBadgeText(audience([{ kind: 'visitor', is: 'new' }, { kind: 'language', in: ['bn'] }], 'any'))).toBe('2 rules · any')
  })

  it('formats money, clock times and days', () => {
    expect(taka('1500')).toBe('৳1,500')
    expect(taka('1500.00')).toBe('৳1,500')
    expect(taka('99.5')).toBe('৳99.50')
    expect(clock('00:00')).toBe('12 AM')
    expect(clock('18:30')).toBe('6:30 PM')
    expect(dayList(['sat', 'fri'])).toBe('Fri, Sat')
    expect(dayList(['mon', 'tue', 'wed', 'thu', 'fri'])).toBe('Mon–Fri')
    expect(toMoneyString('1500')).toBe('1500.00')
    expect(toMoneyString('99.5')).toBe('99.50')
    expect(compareMoney('1500.00', '999.99')).toBe(1)
    expect(compareMoney('10', '10.00')).toBe(0)
    expect(parseValues(' Facebook, sms,,facebook ')).toEqual(['facebook', 'sms'])
  })

  it('starts new rules filled in and offers each kind once', () => {
    expect(newRule('cart')).toEqual({ kind: 'cart', min: '1000.00', max: null })
    expect(audienceProblems(audience([newRule('visitor'), newRule('device'), newRule('cart'), newRule('time'), newRule('language')]))).toEqual([])
    expect(freeKinds(audience([newRule('visitor')]), ['visitor', 'device'])).toEqual(['device'])
  })

  it('finds the problems the server would refuse, at the rule', () => {
    const problems = audienceProblems(
      audience([
        { kind: 'device', in: [] },
        { kind: 'cart', min: '2000.00', max: '1000.00' },
        { kind: 'time', days: [], from: null, to: null },
        { kind: 'campaign', in: [] },
        { kind: 'district', in: [] },
        { kind: 'language', in: [] },
      ]),
    )
    expect(problems.map((p) => p.path)).toEqual(['audience.rules.0.in', 'audience.rules.1.max', 'audience.rules.2.days', 'audience.rules.3.in', 'audience.rules.4.in', 'audience.rules.5.in'])
    expect(audienceProblems(audience([{ kind: 'time', from: '18:00', to: '18:00' }]))[0]).toMatchObject({ path: 'audience.rules.0.to' })
    expect(audienceProblems(audience([{ kind: 'time', from: '18:00', to: null }]))[0]).toMatchObject({ path: 'audience.rules.0.to' })
    expect(audienceProblems(audience([{ kind: 'cart', min: null, max: null }]))[0]).toMatchObject({ path: 'audience.rules.0.min' })
    const seven = audience(Array.from({ length: 7 }, () => newRule('visitor')))
    expect(audienceProblems(seven)[0]).toMatchObject({ path: 'audience.rules', message: 'At most 6 rules.' })
  })
})
