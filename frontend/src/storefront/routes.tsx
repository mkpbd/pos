import type { RouteObject } from 'react-router'
import { StorefrontLayout } from './components/storefront-layout'
import { ContentPage } from './pages/content-page'
import { HomePage } from './pages/home-page'
import { NewsletterConfirmPage, NewsletterUnsubscribePage } from './pages/newsletter-pages'
import { NotFoundPage } from './pages/not-found-page'

/**
 * Storefront pages. Paths must match the server's list of known paths
 * (StorefrontShellController::KNOWN_PATHS; content pages are looked up) so unknown URLs are 404s for crawlers too.
 */
export const storefrontRoutes: RouteObject[] = [
  {
    element: <StorefrontLayout />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'pages/:slug', element: <ContentPage /> },
      { path: 'newsletter/confirm', element: <NewsletterConfirmPage /> },
      { path: 'newsletter/unsubscribe', element: <NewsletterUnsubscribePage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]
