import { useEffect, useRef } from 'react'

/**
 * Runs `send` once per `key` for the life of the component (a product's view, a checkout visit, an
 * order's purchase) — also under StrictMode's double effects. `null` = not yet.
 */
export function useTrackOnce(key: string | null, send: () => void): void {
  const sent = useRef<string | null>(null)
  const latest = useRef(send)
  useEffect(() => {
    latest.current = send
  })
  useEffect(() => {
    if (key === null || sent.current === key) return
    sent.current = key
    try {
      latest.current()
    } catch {
      // Reporting never breaks a page.
    }
  }, [key])
}
