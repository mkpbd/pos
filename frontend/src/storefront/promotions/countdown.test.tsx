import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { formatPrice, formatShortPrice, promotionBadge } from '../money'
import { Countdown } from './countdown-timer'
import { countdownParts, formatCountdown, parseInstant } from './countdown'

const NOW = new Date('2026-11-01T10:00:00Z').getTime()
const at = (ms: number) => new Date(NOW + ms).toISOString()

describe('countdown formatting', () => {
  it('shows hh:mm:ss under a day and days from 24 hours on, rounding up to whole seconds', () => {
    expect(formatCountdown(0)).toBe('00:00:00')
    expect(formatCountdown(1)).toBe('00:00:01')
    expect(formatCountdown(59_001)).toBe('00:01:00')
    expect(formatCountdown((5 * 3600 + 4 * 60 + 3) * 1000)).toBe('05:04:03')
    expect(formatCountdown(86_399_000)).toBe('23:59:59')
    expect(formatCountdown(86_400_000)).toBe('1d 00:00:00')
    expect(formatCountdown((2 * 86_400 + 5 * 3600 + 4 * 60 + 3) * 1000)).toBe('2d 05:04:03')
    expect(formatCountdown(-5000)).toBe('00:00:00')
  })

  it('shows minutes only for reduced motion', () => {
    expect(formatCountdown(61_000, 'minutes')).toBe('00:02')
    expect(formatCountdown((86_400 + 3600) * 1000, 'minutes')).toBe('1d 01:00')
    expect(countdownParts(90_061_000)).toEqual({ days: 1, hours: 1, minutes: 1, seconds: 1 })
  })

  it('parses ISO instants, null for anything else', () => {
    expect(parseInstant('2026-11-01T10:00:00Z')).toBe(NOW)
    expect(parseInstant('soon')).toBeNull()
    expect(parseInstant(null)).toBeNull()
  })
})

describe('promotion badges', () => {
  it('formats percent and fixed promotions on the client', () => {
    expect(promotionBadge({ type: 'percent', value: '10.00' }, 'BDT')).toBe('−10 %')
    expect(promotionBadge({ type: 'percent', value: '12.50' }, 'BDT')).toBe('−12.5 %')
    expect(promotionBadge({ type: 'fixed', value: '20.00' }, 'BDT')).toBe('−৳20')
    expect(promotionBadge({ type: 'fixed', value: '20.50' }, 'BDT')).toBe('−৳20.50')
    expect(promotionBadge({ type: 'free_shipping', value: '0.00' }, 'BDT')).toBeNull()
    expect(formatShortPrice('1500.00', null)).toBe('1,500')
    expect(formatPrice('20.5', 'BDT')).toBe('৳20.50')
  })
})

describe('Countdown', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })
  afterEach(() => vi.useRealTimers())

  it('ticks every second with the digits hidden from screen readers and a static end label', () => {
    render(<Countdown endsAt={at(3_000)} />)

    const time = screen.getByTestId('countdown-time')
    expect(time).toHaveTextContent('Ends in 00:00:03')
    expect(time).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByTestId('countdown')).toHaveAttribute('aria-live', 'off')
    const label = screen.getByText(/^Ends/, { selector: '.sr-only' })
    expect(label.querySelector('time')).toHaveAttribute('datetime', at(3_000))

    act(() => vi.advanceTimersByTime(1_000))
    expect(screen.getByTestId('countdown-time')).toHaveTextContent('Ends in 00:00:02')
    act(() => vi.advanceTimersByTime(1_000))
    expect(screen.getByTestId('countdown-time')).toHaveTextContent('Ends in 00:00:01')
  })

  it('shows days over 24 hours and big boxes in the large variant', () => {
    const { unmount } = render(<Countdown endsAt={at((2 * 86_400 + 5 * 3600 + 4 * 60 + 3) * 1000)} prefix="" variant="chip" />)
    expect(screen.getByTestId('countdown-time')).toHaveTextContent('2d 05:04:03')
    unmount()

    render(<Countdown endsAt={at((86_400 + 61) * 1000)} variant="large" />)
    const boxes = screen.getByTestId('countdown-time')
    expect(boxes).toHaveAttribute('data-remaining', '1d 00:01:01')
    expect(boxes.textContent).toBe('01Day00Hours01Mins01Secs')
  })

  it('calls onExpire once at the end, then renders nothing and leaves no timer behind', () => {
    const onExpire = vi.fn()
    render(<Countdown endsAt={at(2_500)} onExpire={onExpire} />)
    expect(screen.getByTestId('countdown-time')).toHaveTextContent('00:00:03')

    act(() => vi.advanceTimersByTime(500))
    expect(screen.getByTestId('countdown-time')).toHaveTextContent('00:00:02')
    act(() => vi.advanceTimersByTime(2_000))
    expect(screen.queryByTestId('countdown')).not.toBeInTheDocument()
    expect(onExpire).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)

    act(() => vi.advanceTimersByTime(5_000))
    expect(onExpire).toHaveBeenCalledTimes(1)
  })

  it('clears its timer on unmount and renders nothing for a past or missing end', () => {
    const { unmount } = render(<Countdown endsAt={at(60_000)} />)
    expect(vi.getTimerCount()).toBe(1)
    unmount()
    expect(vi.getTimerCount()).toBe(0)

    const onExpire = vi.fn()
    const { container, rerender } = render(<Countdown endsAt={at(-1_000)} onExpire={onExpire} />)
    expect(container).toBeEmptyDOMElement()
    expect(onExpire).toHaveBeenCalledTimes(1)
    rerender(<Countdown endsAt={null} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('updates once a minute without seconds for visitors who prefer reduced motion', () => {
    vi.spyOn(window, 'matchMedia').mockImplementation(
      (query: string) => ({ matches: query.includes('reduce'), media: query, addEventListener: () => {}, removeEventListener: () => {} }) as unknown as MediaQueryList,
    )
    render(<Countdown endsAt={at(3 * 60_000 + 10_000)} />)
    expect(screen.getByTestId('countdown-time')).toHaveTextContent('Ends in 00:04')
    act(() => vi.advanceTimersByTime(9_000))
    expect(screen.getByTestId('countdown-time')).toHaveTextContent('Ends in 00:04')
    act(() => vi.advanceTimersByTime(1_000))
    expect(screen.getByTestId('countdown-time')).toHaveTextContent('Ends in 00:03')
  })
})
