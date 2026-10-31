import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router'
import { AppProviders } from '@/app/providers'
import { routes } from '@/app/routes'
import { setContextHeaderProvider } from '@/lib/api/client'
import { useSessionStore } from '@/stores/session-store'
import './index.css'

// Every API request carries the active branch (validated server-side by the tenant middleware).
setContextHeaderProvider(() => {
  const branchId = useSessionStore.getState().activeBranchId
  return branchId ? { 'X-Branch-Id': branchId } : ({} as Record<string, string>)
})

// The back office lives under /admin; the storefront (storefront.html) owns every other path.
const ADMIN_BASENAME = '/admin'

const router = createBrowserRouter(routes, { basename: ADMIN_BASENAME })

const root = document.getElementById('root')
if (!root) throw new Error('Root element #root not found')

createRoot(root).render(
  <StrictMode>
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>
  </StrictMode>,
)
