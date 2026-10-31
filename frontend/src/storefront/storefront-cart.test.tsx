import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { fail, mockApi, ok, renderRoutes } from '@/test/utils'
import { storefrontRoutes } from './routes'
import { bootstrapFixture, cartFixture, cartLine, customerFixture, listingBody, productCard, productDetail } from './test-fixtures'
import type { Cart, Customer, Wishlist } from './types'
import { LOCAL_WISHLIST_KEY } from './wishlist/local-wishlist'

afterEach(() => localStorage.clear())

type Routes = Parameters<typeof mockApi>[0]

const bodyOf = (init: RequestInit) => JSON.parse(String(init.body ?? 'null')) as Record<string, unknown>

/** Bootstrap, an empty homepage, the customer (guest by default) and a cart. */
function serve(options: { me?: Customer | null; cart?: Cart; routes?: Routes; bootstrap?: ReturnType<typeof bootstrapFixture> } = {}) {
  return mockApi({
    'GET /store/bootstrap': ok(options.bootstrap ?? bootstrapFixture()),
    'GET /store/homepage': ok({ sections: [], preview: false }),
    'GET /store/account/me': ok(options.me ?? null),
    'GET /store/cart': ok(options.cart ?? cartFixture()),
    'GET /store/wishlist': ok({ items: [] }),
    ...options.routes,
  })
}

describe('header', () => {
  it('shows sign-in, wishlist and cart with their counts', async () => {
    localStorage.setItem(LOCAL_WISHLIST_KEY, JSON.stringify([{ product_id: 'p-1', slug: 'kids-tee', variant_id: null }, { product_id: 'p-2', slug: 'kids-cap', variant_id: null }]))
    serve({ cart: cartFixture([cartLine('l-1')], { item_count: '3' }) })
    renderRoutes(storefrontRoutes)

    expect(await screen.findByRole('button', { name: 'Cart, 3 items' })).toBeInTheDocument()
    expect(screen.getByTestId('cart-count')).toHaveTextContent('3')
    expect(screen.getByRole('link', { name: 'Wishlist, 2 items' })).toHaveAttribute('href', '/wishlist')
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/account/login')
  })

  it('shows the account menu with sign-out for a customer, and the server wishlist count', async () => {
    const fetchMock = serve({
      me: customerFixture(),
      routes: {
        'GET /store/wishlist': ok({ items: [{ id: 'w-1', product: productCard('kids-tee'), variant_id: null }] }),
        'POST /store/account/logout': { status: 204 },
      },
    })
    renderRoutes(storefrontRoutes)
    const user = userEvent.setup()

    expect(await screen.findByRole('link', { name: 'Wishlist, 1 item' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cart' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'My account' }))
    const menu = await screen.findByRole('menu')
    expect(within(menu).getByRole('menuitem', { name: 'Addresses' })).toHaveAttribute('href', '/account/addresses')
    await user.click(within(menu).getByRole('menuitem', { name: 'Sign out' }))

    expect(await screen.findByRole('link', { name: 'Sign in' })).toBeInTheDocument()
    expect(await screen.findByText('You are signed out.')).toBeInTheDocument()
    expect(fetchMock.mock.calls.some(([url, init]) => String(url).endsWith('/store/account/logout') && init?.method === 'POST')).toBe(true)
  })
})

describe('mini-cart', () => {
  it('opens from the header, changes quantities and removes lines, and closes with Escape', async () => {
    let cart = cartFixture([cartLine('l-1', { max_quantity: '5.000' }), cartLine('l-2', { product: { slug: 'kids-cap', name: 'Kids Cap', url: '/product/kids-cap', image: null }, variant_name: null, option_values: {}, quantity: '1', line_total: '450.00' })], { item_count: '3', subtotal: '1350.00', total: '1350.00' })
    const patches: unknown[] = []
    serve({
      cart,
      routes: {
        'GET /store/cart': () => ok(cart),
        'PATCH /store/cart/items/l-1': (init) => {
          patches.push(bodyOf(init))
          cart = { ...cart, items: cart.items.map((l) => (l.id === 'l-1' ? { ...l, quantity: '3', line_total: '1350.00' } : l)), item_count: '4', subtotal: '1800.00', total: '1800.00' }
          return ok(cart)
        },
        'DELETE /store/cart/items/l-2': () => {
          cart = { ...cart, items: cart.items.filter((l) => l.id !== 'l-2'), item_count: '3', subtotal: '1350.00', total: '1350.00' }
          return ok(cart)
        },
      },
    })
    renderRoutes(storefrontRoutes)
    const user = userEvent.setup()

    const cartButton = await screen.findByRole('button', { name: 'Cart, 3 items' })
    await user.click(cartButton)
    const drawer = await screen.findByRole('dialog', { name: 'Your cart (3)' })
    expect(within(drawer).getAllByTestId('cart-line')).toHaveLength(2)
    expect(within(drawer).getByTestId('cart-subtotal')).toHaveTextContent('৳1,350.00')
    expect(within(drawer).getByText('Prices include VAT.')).toBeInTheDocument()
    expect(within(drawer).getByRole('link', { name: 'View cart' })).toHaveAttribute('href', '/cart')
    expect(within(drawer).getByRole('link', { name: 'Checkout' })).toHaveAttribute('href', '/checkout')

    await user.click(within(drawer).getByRole('button', { name: 'Increase: Quantity of Kids Tee (Red / M)' }))
    await waitFor(() => expect(within(drawer).getByTestId('cart-subtotal')).toHaveTextContent('৳1,800.00'))
    expect(patches).toEqual([{ quantity: '3' }])
    expect(within(drawer).getByRole('textbox', { name: 'Quantity of Kids Tee (Red / M)' })).toHaveValue('3')
    expect(screen.getByTestId('cart-count')).toHaveTextContent('4')

    await user.click(within(drawer).getByRole('button', { name: 'Remove Kids Cap from the cart' }))
    await waitFor(() => expect(within(drawer).getAllByTestId('cart-line')).toHaveLength(1))

    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(cartButton).toHaveFocus()
  })

  it('shows the empty cart', async () => {
    serve()
    renderRoutes(storefrontRoutes)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Cart' }))
    const drawer = await screen.findByRole('dialog', { name: 'Your cart' })
    expect(within(drawer).getByText('Your cart is empty.')).toBeInTheDocument()
  })
})

function serveProduct(routes: Routes = {}) {
  return serve({
    routes: {
      'GET /store/products/kids-tee': ok(productDetail()),
      'GET /store/products/kids-tee/related': ok({ related: [], frequently_bought: [] }),
      'GET /store/products': { body: listingBody([], { facets: null }) },
      ...routes,
    },
  })
}

describe('add to cart', () => {
  it('adds the chosen variant with its quantity from the product page and opens the mini-cart', async () => {
    const posts: unknown[] = []
    let cart = cartFixture()
    serveProduct({
      'GET /store/cart': () => ok(cart),
      'POST /store/cart/items': (init) => {
        posts.push(bodyOf(init))
        cart = cartFixture([cartLine('l-1')], { item_count: '2' })
        return ok(cart)
      },
    })
    renderRoutes(storefrontRoutes, '/product/kids-tee')
    const user = userEvent.setup()

    const form = await screen.findByRole('form', { name: 'Add to cart' })
    await user.click(within(form).getByRole('button', { name: 'Increase: Quantity of Kids Tee' }))
    expect(within(form).getByRole('textbox', { name: 'Quantity of Kids Tee' })).toHaveValue('2')
    await user.click(within(form).getByRole('button', { name: 'Add to cart' }))

    const drawer = await screen.findByRole('dialog', { name: 'Your cart (2)' })
    expect(posts).toEqual([{ variant_id: 'v-red-m', quantity: '2' }])
    expect(within(drawer).getByRole('link', { name: 'Kids Tee' })).toHaveAttribute('href', '/product/kids-tee')
  })

  it('is disabled for an out-of-stock variant and explains stock errors', async () => {
    serveProduct({ 'POST /store/cart/items': fail(422, 'INSUFFICIENT_STOCK', 'Not enough stock', { max_quantity: '3.000' }) })
    renderRoutes(storefrontRoutes, '/product/kids-tee')
    const user = userEvent.setup()

    const form = await screen.findByRole('form', { name: 'Add to cart' })
    const quantity = within(form).getByRole('textbox', { name: 'Quantity of Kids Tee' })
    await user.clear(quantity)
    await user.type(quantity, '7{Enter}')
    await user.click(within(form).getByRole('button', { name: 'Add to cart' }))
    expect(await within(form).findByRole('alert')).toHaveTextContent('Only 3 available.')
    // The stock hint caps the stepper.
    expect(within(form).getByRole('button', { name: 'Increase: Quantity of Kids Tee' })).toBeDisabled()

    await user.click(within(screen.getByTestId('variant-selector')).getByRole('radio', { name: 'L (out of stock)' }))
    const fresh = screen.getByRole('form', { name: 'Add to cart' })
    expect(within(fresh).getByRole('button', { name: 'Add to cart' })).toBeDisabled()
    expect(within(fresh).getByText('This option is out of stock.')).toBeInTheDocument()
  })

  it('adds from the quick view, which gives way to the mini-cart', async () => {
    serveProduct({
      'GET /store/products': { body: listingBody([productCard('kids-tee', { variant_count: 3, default_variant_id: null })]) },
      'POST /store/cart/items': ok(cartFixture([cartLine('l-1')], { item_count: '1' })),
    })
    renderRoutes(storefrontRoutes, '/shop')
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Quick view: Kids Tee' }))
    const quickView = await screen.findByRole('dialog', { name: 'Kids Tee' })
    await user.click(within(quickView).getByRole('button', { name: 'Add to cart' }))

    const drawer = await screen.findByRole('dialog', { name: 'Your cart (1)' })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Kids Tee' })).not.toBeInTheDocument())
    await waitFor(() => expect(drawer.contains(document.activeElement)).toBe(true))
  })

  it('adds single-variant products from their card and links the others to their page', async () => {
    const posts: unknown[] = []
    serve({
      routes: {
        'GET /store/products': { body: listingBody([productCard('kids-cap'), productCard('kids-tee', { variant_count: 3, default_variant_id: null })]) },
        'POST /store/cart/items': (init) => {
          posts.push(bodyOf(init))
          return ok(cartFixture([cartLine('l-1')], { item_count: '1' }))
        },
      },
    })
    renderRoutes(storefrontRoutes, '/shop')
    const user = userEvent.setup()

    expect(await screen.findByRole('link', { name: 'Choose options: Kids Tee' })).toHaveAttribute('href', '/product/kids-tee')
    await user.click(screen.getByRole('button', { name: 'Add Kids Cap to the cart' }))
    expect(await screen.findByRole('dialog', { name: 'Your cart (1)' })).toBeInTheDocument()
    expect(posts).toEqual([{ variant_id: 'v-kids-cap', quantity: '1' }])
  })
})

describe('cart page', () => {
  it('lists the lines with flags and a fix, the server totals with VAT, and holds checkout until fixed', async () => {
    const patches: unknown[] = []
    const cart = cartFixture(
      [
        cartLine('l-1', { quantity: '4', max_quantity: '2.000', exceeds_stock: true, line_total: '900.00', compare_at_price: '500.00' }),
        cartLine('l-2', { product: { slug: 'old-hat', name: 'Old Hat', url: '/product/old-hat', image: null }, variant_name: null, option_values: {}, purchasable: false }),
        cartLine('l-3', { product: { slug: 'kids-cap', name: 'Kids Cap', url: '/product/kids-cap', image: null }, variant_name: null, option_values: {}, in_stock: false, max_quantity: '0.000' }),
      ],
      { item_count: '2', subtotal: '900.00', tax_total: '135.00', total: '1035.00', prices_include_tax: false, issues: ['exceeds_stock', 'unavailable'] },
    )
    serve({
      cart,
      routes: {
        'PATCH /store/cart/items/l-1': (init) => {
          patches.push(bodyOf(init))
          return ok({ ...cart, items: [{ ...cart.items[0]!, quantity: '2', exceeds_stock: false }, ...cart.items.slice(1)] })
        },
      },
    })
    renderRoutes(storefrontRoutes, '/cart')
    const user = userEvent.setup()

    expect(await screen.findByRole('heading', { level: 1, name: 'Your cart' })).toBeInTheDocument()
    await waitFor(() => expect(document.title).toBe('Cart | Berry Kids'))
    const page = screen.getByTestId('cart-page')
    const [tee, hat, cap] = within(page).getAllByTestId('cart-line')
    expect(within(tee!).getByText('Only 2 left in stock.')).toBeInTheDocument()
    expect(within(tee!).getByText('৳500.00', { exact: false }).closest('s')).not.toBeNull()
    expect(within(hat!).getByTestId('line-flag')).toHaveTextContent('No longer available')
    expect(within(hat!).getByTestId('line-total')).toHaveTextContent('Not included')
    expect(within(cap!).getByTestId('line-flag')).toHaveTextContent('Out of stock')
    expect(screen.getByText(/Some items in your cart need your attention/)).toBeInTheDocument()

    expect(screen.getByTestId('cart-subtotal')).toHaveTextContent('৳900.00')
    expect(screen.getByTestId('cart-tax')).toHaveTextContent('৳135.00')
    expect(screen.getByText('VAT')).toBeInTheDocument()
    expect(screen.getByTestId('cart-total')).toHaveTextContent('৳1,035.00')
    expect(screen.queryByTestId('vat-note')).not.toBeInTheDocument()
    const checkout = screen.getByRole('button', { name: 'Checkout' })
    expect(checkout).toBeDisabled()
    expect(checkout).toHaveAccessibleDescription('Please fix the items marked in your cart before checking out.')
    expect(screen.queryByRole('link', { name: /checkout/i })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Continue shopping' })).toHaveAttribute('href', '/shop')

    await user.click(within(tee!).getByRole('button', { name: 'Change quantity to 2' }))
    await waitFor(() => expect(screen.queryByText('Only 2 left in stock.')).not.toBeInTheDocument())
    expect(patches).toEqual([{ quantity: '2' }])
  })

  it('notes VAT included in prices, and shows the empty cart', async () => {
    serve({ cart: cartFixture([cartLine('l-1')], { tax_total: '117.39' }) })
    const { unmount } = renderRoutes(storefrontRoutes, '/cart')
    expect(await screen.findByTestId('vat-note')).toHaveTextContent('Prices include VAT (৳117.39).')
    expect(screen.queryByTestId('cart-tax')).not.toBeInTheDocument()
    unmount()

    serve()
    renderRoutes(storefrontRoutes, '/cart')
    expect(await screen.findByText('Your cart is empty.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Start shopping' })).toHaveAttribute('href', '/shop')
  })

  it('keeps a typed quantity that is not allowed from being sent', async () => {
    const fetchMock = serve({ cart: cartFixture([cartLine('l-1')]) })
    renderRoutes(storefrontRoutes, '/cart')
    const user = userEvent.setup()
    const input = await screen.findByRole('textbox', { name: 'Quantity of Kids Tee (Red / M)' })
    await user.clear(input)
    await user.type(input, '1.5{Enter}')
    expect(input).toHaveValue('2')
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(false)
  })
})

describe('wishlist', () => {
  it('keeps a guest wishlist in this browser and shows it fresh from the catalog', async () => {
    const slugRequests: string[] = []
    serve({
      routes: {
        'GET /store/products': (_init, url) => {
          const slugs = url.searchParams.get('slugs')
          if (slugs) slugRequests.push(slugs)
          return { body: listingBody(slugs ? slugs.split(',').map((s) => productCard(s)) : [productCard('kids-cap')]) }
        },
      },
    })
    const { router } = renderRoutes(storefrontRoutes, '/shop')
    const user = userEvent.setup()

    const heart = await screen.findByRole('button', { name: 'Add Kids Cap to the wishlist' })
    await user.click(heart)
    expect(heart).toHaveAttribute('aria-pressed', 'true')
    expect(heart).toHaveAccessibleName('Remove Kids Cap from the wishlist')
    expect(JSON.parse(localStorage.getItem(LOCAL_WISHLIST_KEY) ?? '[]')).toEqual([{ product_id: 'p-kids-cap', slug: 'kids-cap', variant_id: null }])
    expect(screen.getByRole('link', { name: 'Wishlist, 1 item' })).toBeInTheDocument()

    await user.click(screen.getByRole('link', { name: 'Wishlist, 1 item' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/wishlist'))
    const page = await screen.findByTestId('wishlist-page')
    expect(await within(page).findByRole('link', { name: 'Kids Cap' })).toBeInTheDocument()
    expect(slugRequests).toEqual(['kids-cap'])
    expect(within(page).getByText(/saved in this browser/)).toBeInTheDocument()

    await user.click(within(page).getByRole('button', { name: 'Remove Kids Cap' }))
    expect(await within(page).findByText('Your wishlist is empty.')).toBeInTheDocument()
    expect(localStorage.getItem(LOCAL_WISHLIST_KEY)).toBeNull()
  })

  it('saves to the account when signed in and moves single-variant products to the cart', async () => {
    let wishlist: Wishlist = { items: [] }
    const calls: string[] = []
    serveProduct({
      'GET /store/account/me': ok(customerFixture()),
      'GET /store/wishlist': () => ok(wishlist),
      'POST /store/wishlist/items': (init) => {
        calls.push(`add ${String(bodyOf(init).product_id)}`)
        wishlist = { items: [{ id: 'w-1', product: productCard('kids-tee', { id: 'p-tee' }), variant_id: null }, { id: 'w-2', product: productCard('kids-cap'), variant_id: null }] }
        return ok(wishlist)
      },
      'DELETE /store/wishlist/items/w-2': () => {
        calls.push('remove w-2')
        wishlist = { items: wishlist.items.filter((i) => i.id !== 'w-2') }
        return ok(wishlist)
      },
      'POST /store/cart/items': (init) => {
        calls.push(`cart ${String(bodyOf(init).variant_id)}`)
        return ok(cartFixture([cartLine('l-1')], { item_count: '1' }))
      },
    })
    const { router } = renderRoutes(storefrontRoutes, '/product/kids-tee')
    const user = userEvent.setup()

    const toggle = await screen.findByRole('button', { name: 'Add to wishlist' })
    await waitFor(() => expect(toggle).toBeEnabled())
    await user.click(toggle)
    expect(await screen.findByRole('button', { name: 'Saved to wishlist' })).toHaveAttribute('aria-pressed', 'true')
    expect(calls).toEqual(['add p-tee'])
    expect(localStorage.getItem(LOCAL_WISHLIST_KEY)).toBeNull()

    await router.navigate('/wishlist')
    const page = await screen.findByTestId('wishlist-page')
    expect(within(page).getAllByTestId('product-card')).toHaveLength(2)
    expect(within(page).queryByText(/saved in this browser/)).not.toBeInTheDocument()
    await user.click(within(page).getByRole('button', { name: 'Move Kids Cap to the cart' }))
    expect(await screen.findByRole('dialog', { name: 'Your cart (1)' })).toBeInTheDocument()
    await waitFor(() => expect(calls).toEqual(['add p-tee', 'cart v-kids-cap', 'remove w-2']))
  })
})
