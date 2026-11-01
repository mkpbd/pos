import type { RouteObject } from 'react-router'
import { AccountPage, ProfilePage, VerifyEmailPage } from './account/account-pages'
import { AddressesPage } from './account/addresses-page'
import { ForgotPasswordPage, LoginPage, RegisterPage, ResetPasswordPage } from './account/auth-pages'
import { GuestOnly, RequireCustomer } from './account/guards'
import { BlogIndexPage, BlogPostPage } from './blog/blog-pages'
import { CartPage } from './cart/cart-page'
import { CheckoutPage } from './checkout/checkout-page'
import { StorefrontLayout } from './components/storefront-layout'
import { ContentPage } from './pages/content-page'
import { HomePage } from './pages/home-page'
import { BrandPage, CategoryPage, SearchPage, ShopPage } from './pages/listing-page'
import { NewsletterConfirmPage, NewsletterUnsubscribePage } from './pages/newsletter-pages'
import { AccountOrderPage } from './orders/account-order-page'
import { AccountOrdersPage } from './orders/account-orders-page'
import { AccountReturnsPage } from './orders/account-returns-page'
import { OrderPage } from './orders/order-page'
import { NotFoundPage } from './pages/not-found-page'
import { ProductPage } from './pages/product-page'
import { MyReviewsPage } from './reviews/my-reviews-page'
import { WishlistPage } from './wishlist/wishlist-page'

/**
 * Storefront pages. Paths must match the server's list of known paths
 * (StorefrontShellController::KNOWN_PATHS; content pages, blog posts and categories, product categories, brands and products are looked up) so unknown URLs are 404s for crawlers too.
 * Checkout is open to guests unless the store requires an account (the page says so); an
 * order page needs the guest's access token or the signed-in owner.
 * Account pages need a signed-in customer (else /account/login?next=…); sign-in, registration
 * and password pages send signed-in customers on to /account (or a safe `next`).
 */
export const storefrontRoutes: RouteObject[] = [
  {
    element: <StorefrontLayout />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'shop', element: <ShopPage /> },
      { path: 'search', element: <SearchPage /> },
      { path: 'category/:slug', element: <CategoryPage /> },
      { path: 'brand/:slug', element: <BrandPage /> },
      { path: 'product/:slug', element: <ProductPage /> },
      { path: 'pages/:slug', element: <ContentPage /> },
      { path: 'blog', element: <BlogIndexPage /> },
      { path: 'blog/category/:slug', element: <BlogIndexPage /> },
      { path: 'blog/:slug', element: <BlogPostPage /> },
      { path: 'newsletter/confirm', element: <NewsletterConfirmPage /> },
      { path: 'newsletter/unsubscribe', element: <NewsletterUnsubscribePage /> },
      { path: 'cart', element: <CartPage /> },
      { path: 'wishlist', element: <WishlistPage /> },
      { path: 'checkout', element: <CheckoutPage /> },
      { path: 'order/:number', element: <OrderPage /> },
      { path: 'account/verify-email', element: <VerifyEmailPage /> },
      {
        element: <GuestOnly />,
        children: [
          { path: 'account/login', element: <LoginPage /> },
          { path: 'account/register', element: <RegisterPage /> },
          { path: 'account/forgot-password', element: <ForgotPasswordPage /> },
          { path: 'account/reset-password', element: <ResetPasswordPage /> },
        ],
      },
      {
        element: <RequireCustomer />,
        children: [
          { path: 'account', element: <AccountPage /> },
          { path: 'account/profile', element: <ProfilePage /> },
          { path: 'account/addresses', element: <AddressesPage /> },
          { path: 'account/orders', element: <AccountOrdersPage /> },
          { path: 'account/orders/:number', element: <AccountOrderPage /> },
          { path: 'account/returns', element: <AccountReturnsPage /> },
          { path: 'account/reviews', element: <MyReviewsPage /> },
        ],
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]
