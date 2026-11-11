import { lazy, Suspense, type ComponentType } from 'react'
import type { RouteObject } from 'react-router'
import { GuestOnly, RequireCustomer } from './account/guards'
import { StorefrontLayout } from './components/storefront-layout'
import { PageLoadingView } from './components/state-views'
import { HomePage } from './pages/home-page'
import { BrandPage, CategoryPage, SearchPage, ShopPage } from './pages/listing-page'
import { NotFoundPage } from './pages/not-found-page'
import { ProductPage } from './pages/product-page'

/**
 * A page whose code is fetched on first visit (React.lazy), with an accessible loading state
 * meanwhile. The browse path (home, listings, product) stays in the entry bundle; checkout, the
 * account area, order pages, cart, wishlist, blog, content and newsletter pages are split off.
 */
const lazyComponents = new WeakMap<() => Promise<unknown>, Map<string, ComponentType>>()

function lazyPage<M extends Record<string, unknown>>(load: () => Promise<M>, name: keyof M & string) {
  // One component per export, so routes sharing a page (blog index and blog category) keep it mounted.
  const byName = lazyComponents.get(load) ?? new Map<string, ComponentType>()
  lazyComponents.set(load, byName)
  const Page = byName.get(name) ?? lazy(() => load().then((module) => ({ default: module[name] as ComponentType })))
  byName.set(name, Page)
  return (
    <Suspense fallback={<PageLoadingView />}>
      <Page />
    </Suspense>
  )
}

const account = () => import('./account/account-pages')
const auth = () => import('./account/auth-pages')
const blog = () => import('./blog/blog-pages')
const newsletter = () => import('./pages/newsletter-pages')

/**
 * Storefront pages. Paths must match the server's list of known paths
 * (StorefrontShellController::KNOWN_PATHS; content pages, blog posts and categories, product categories, brands and products are looked up) so unknown URLs are 404s for crawlers too.
 * Checkout is open to guests unless the store requires an account (the page says so); an
 * order page needs the guest's access token or the signed-in owner.
 * Account pages need a signed-in customer (else /account/login?next=…); sign-in, registration
 * and password pages send signed-in customers on to /account (or a safe `next`).
 */
export const storefrontRoutes: RouteObject[] = [
  // The demo gallery belongs to no store: outside the layout, so it works on any host.
  { path: 'demos', element: lazyPage(() => import('./demos/demo-gallery-page'), 'DemoGalleryPage') },
  {
    element: <StorefrontLayout />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'shop', element: <ShopPage /> },
      { path: 'search', element: <SearchPage /> },
      { path: 'category/:slug', element: <CategoryPage /> },
      { path: 'brand/:slug', element: <BrandPage /> },
      { path: 'product/:slug', element: <ProductPage /> },
      { path: 'pages/:slug', element: lazyPage(() => import('./pages/content-page'), 'ContentPage') },
      { path: 'blog', element: lazyPage(blog, 'BlogIndexPage') },
      { path: 'blog/category/:slug', element: lazyPage(blog, 'BlogIndexPage') },
      { path: 'blog/:slug', element: lazyPage(blog, 'BlogPostPage') },
      { path: 'newsletter/confirm', element: lazyPage(newsletter, 'NewsletterConfirmPage') },
      { path: 'newsletter/unsubscribe', element: lazyPage(newsletter, 'NewsletterUnsubscribePage') },
      { path: 'cart', element: lazyPage(() => import('./cart/cart-page'), 'CartPage') },
      { path: 'wishlist', element: lazyPage(() => import('./wishlist/wishlist-page'), 'WishlistPage') },
      { path: 'checkout', element: lazyPage(() => import('./checkout/checkout-page'), 'CheckoutPage') },
      { path: 'order/:number', element: lazyPage(() => import('./orders/order-page'), 'OrderPage') },
      { path: 'account/verify-email', element: lazyPage(account, 'VerifyEmailPage') },
      {
        element: <GuestOnly />,
        children: [
          { path: 'account/login', element: lazyPage(auth, 'LoginPage') },
          { path: 'account/register', element: lazyPage(auth, 'RegisterPage') },
          { path: 'account/forgot-password', element: lazyPage(auth, 'ForgotPasswordPage') },
          { path: 'account/reset-password', element: lazyPage(auth, 'ResetPasswordPage') },
        ],
      },
      {
        element: <RequireCustomer />,
        children: [
          { path: 'account', element: lazyPage(account, 'AccountPage') },
          { path: 'account/profile', element: lazyPage(account, 'ProfilePage') },
          { path: 'account/addresses', element: lazyPage(() => import('./account/addresses-page'), 'AddressesPage') },
          { path: 'account/orders', element: lazyPage(() => import('./orders/account-orders-page'), 'AccountOrdersPage') },
          { path: 'account/orders/:number', element: lazyPage(() => import('./orders/account-order-page'), 'AccountOrderPage') },
          { path: 'account/returns', element: lazyPage(() => import('./orders/account-returns-page'), 'AccountReturnsPage') },
          { path: 'account/reviews', element: lazyPage(() => import('./reviews/my-reviews-page'), 'MyReviewsPage') },
        ],
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]
