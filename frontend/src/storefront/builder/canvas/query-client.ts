import { QueryClient } from '@tanstack/react-query'
import { LOCALES } from '../../i18n/runtime'
import { customerKeys, localized } from '../../store-keys'

/**
 * The canvas's query client: nothing goes stale, nothing retries, and the shopper is a guest
 * (product cards ask who is signed in for the wishlist heart). Together with the offline
 * onlineManager (./main.tsx) no store request leaves the canvas.
 */
export function createCanvasQueryClient(): QueryClient {
  const client = new QueryClient({
    defaultOptions: {
      queries: { staleTime: Infinity, gcTime: Infinity, retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false, refetchOnMount: false },
      mutations: { retry: false },
    },
  })
  for (const locale of LOCALES) client.setQueryData(localized(customerKeys.me, locale), null)
  return client
}
