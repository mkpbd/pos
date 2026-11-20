import { Navigate, useLocation } from 'react-router'

/** "/online-store/ai" (the AI2a contract's address) opens Online store → AI help at /storefront/ai, keeping the tab and state. */
export function OnlineStoreAiRedirect() {
  const location = useLocation()
  return <Navigate to={{ pathname: '/storefront/ai', search: location.search }} state={location.state} replace />
}
