import type { ReactNode } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { createTestQueryClient, fail, mockApi, ok } from '@/test/utils'
import { useAddToCartMutation, useCartQuery, useUpdateCartItemMutation } from './cart/api'
import { customerKeys } from './store-keys'
import { cartFixture, cartLine, customerFixture, productCard } from './test-fixtures'
import { useWishlist } from './wishlist/api'
import { LOCAL_WISHLIST_KEY } from './wishlist/local-wishlist'

afterEach(() => localStorage.clear())

function wrapper() {
  const queryClient = createTestQueryClient()
  return {
    queryClient,
    Wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
  }
}

describe('cart hooks', () => {
  it('replace the cached cart with the repriced cart each change returns', async () => {
    const repriced = cartFixture([cartLine('l-1', { quantity: '3', line_total: '1350.00' })], { item_count: '3', subtotal: '1350.00', total: '1350.00' })
    mockApi({
      'GET /store/cart': ok(cartFixture()),
      'POST /store/cart/items': ok(cartFixture([cartLine('l-1')])),
      'PATCH /store/cart/items/l-1': ok(repriced),
    })
    const { Wrapper, queryClient } = wrapper()
    const { result } = renderHook(() => ({ cart: useCartQuery(), add: useAddToCartMutation(), update: useUpdateCartItemMutation() }), { wrapper: Wrapper })

    await waitFor(() => expect(result.current.cart.data?.items).toEqual([]))
    await act(() => result.current.add.mutateAsync({ variant_id: 'v-l-1', quantity: '2' }))
    await waitFor(() => expect(result.current.cart.data?.item_count).toBe('2'))
    await act(() => result.current.update.mutateAsync({ id: 'l-1', quantity: '3' }))
    expect(queryClient.getQueryData(customerKeys.cart)).toEqual(repriced)
  })

  it('refetch the cart when a line is gone (404)', async () => {
    let reads = 0
    mockApi({
      'GET /store/cart': () => {
        reads += 1
        return ok(cartFixture())
      },
      'PATCH /store/cart/items/gone': fail(404, 'NOT_FOUND'),
    })
    const { Wrapper } = wrapper()
    const { result } = renderHook(() => ({ cart: useCartQuery(), update: useUpdateCartItemMutation() }), { wrapper: Wrapper })
    await waitFor(() => expect(result.current.cart.data).toBeDefined())
    await act(() => result.current.update.mutateAsync({ id: 'gone', quantity: '1' }).catch(() => undefined))
    await waitFor(() => expect(reads).toBe(2))
  })
})

describe('useWishlist', () => {
  it('keeps a guest list in this browser and never calls the server for it', async () => {
    const fetchMock = mockApi({ 'GET /store/account/me': ok(null) })
    const { Wrapper } = wrapper()
    const { result } = renderHook(() => useWishlist(), { wrapper: Wrapper })

    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current.signedIn).toBe(false)
    await act(() => result.current.toggle({ id: 'p-1', slug: 'kids-tee' }))
    expect(result.current.isSaved('p-1')).toBe(true)
    expect(result.current.count).toBe(1)
    expect(localStorage.getItem(LOCAL_WISHLIST_KEY)).toContain('kids-tee')
    await act(() => result.current.toggle({ id: 'p-1', slug: 'kids-tee' }))
    expect(result.current.count).toBe(0)
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual(['/api/v1/store/account/me'])
  })

  it('uses the account list when signed in: add by product id, remove by item id', async () => {
    const calls: string[] = []
    let items = [{ id: 'w-1', product: productCard('kids-cap'), variant_id: null }]
    mockApi({
      'GET /store/account/me': ok(customerFixture()),
      'GET /store/wishlist': () => ok({ items }),
      'POST /store/wishlist/items': (init) => {
        calls.push(`add ${String(init.body)}`)
        items = [...items, { id: 'w-2', product: productCard('kids-tee'), variant_id: null }]
        return ok({ items })
      },
      'DELETE /store/wishlist/items/w-1': () => {
        calls.push('remove w-1')
        items = items.filter((i) => i.id !== 'w-1')
        return ok({ items })
      },
    })
    const { Wrapper } = wrapper()
    const { result } = renderHook(() => useWishlist(), { wrapper: Wrapper })

    await waitFor(() => expect(result.current.count).toBe(1))
    expect(result.current.isSaved('p-kids-cap')).toBe(true)
    await act(() => result.current.toggle({ id: 'p-kids-tee', slug: 'kids-tee' }))
    await waitFor(() => expect(result.current.isSaved('p-kids-tee')).toBe(true))
    await act(() => result.current.toggle({ id: 'p-kids-cap', slug: 'kids-cap' }))
    await waitFor(() => expect(result.current.isSaved('p-kids-cap')).toBe(false))
    expect(calls).toEqual(['add {"product_id":"p-kids-tee"}', 'remove w-1'])
    expect(localStorage.getItem(LOCAL_WISHLIST_KEY)).toBeNull()
  })
})
