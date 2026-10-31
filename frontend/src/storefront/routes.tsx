import type { RouteObject } from 'react-router'
import { StorefrontLayout } from './components/storefront-layout'
import { HomePage } from './pages/home-page'
import { NotFoundPage } from './pages/not-found-page'

/**
 * Storefront pages. Paths must match the server's list of known paths
 * (StorefrontShellController::KNOWN_PATHS) so unknown URLs are 404s for crawlers too.
 */
export const storefrontRoutes: RouteObject[] = [
  {
    element: <StorefrontLayout />,
    children: [
      { index: true, element: <HomePage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]
