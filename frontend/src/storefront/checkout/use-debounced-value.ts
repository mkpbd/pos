import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { stableStringify } from './placement-attempt'

/**
 * `value` once it has stopped changing for `delay` ms (compared by content, so a new object
 * with the same fields is no change). The first value is taken at once.
 * Returns the settled value and whether a newer one is still waiting.
 */
export function useDebouncedValue<T>(value: T, delay: number): [T, boolean] {
  const key = stableStringify(value)
  const [settled, setSettled] = useState({ key, value })
  const latest = useRef(value)
  useLayoutEffect(() => {
    latest.current = value
  })

  useEffect(() => {
    if (key === settled.key) return
    const timer = setTimeout(() => setSettled({ key, value: latest.current }), delay)
    return () => clearTimeout(timer)
  }, [key, settled.key, delay])

  return [settled.value, key !== settled.key]
}
