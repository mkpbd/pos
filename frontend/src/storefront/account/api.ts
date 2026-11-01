import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { ApiError } from '@/lib/api/client'
import { storeApi } from '../http'
import { useNotice } from '../notices'
import { accountKeys, customerKeys } from '../store-keys'
import type { AddressInput, Customer, CustomerAddress, GeoDistrict, GeoDivision, SignInResult } from '../types'
import { clearLocalWishlist, readLocalWishlist } from '../wishlist/local-wishlist'

/** The signed-in customer, null for guests (GET /store/account/me also issues the CSRF cookie). */
export function useMeQuery() {
  return useQuery({
    queryKey: customerKeys.me,
    queryFn: ({ signal }) => storeApi.get<Customer | null>('/store/account/me', { signal }).then((r) => r.data ?? null),
    staleTime: 5 * 60_000,
    retry: (count, error) => !(error instanceof ApiError && error.status < 500) && count < 1,
  })
}

/** The customer once known; null for guests and while unknown (a failed lookup counts as a guest). */
export function useCustomer(): Customer | null {
  return useMeQuery().data ?? null
}

export type LoginInput = { email: string; password: string; remember: boolean }
export type RegisterInput = { name: string; email: string; phone?: string; password: string; password_confirmation: string }

/**
 * After sign-in: the guest's local wishlist goes to the account (and is cleared once the server
 * took it), then everything customer-specific is fetched afresh. A failed merge keeps the local
 * list for the next sign-in.
 */
async function mergeLocalWishlist(): Promise<void> {
  const local = readLocalWishlist()
  if (local.length === 0) return
  try {
    await storeApi.post('/store/wishlist/merge', { items: local.map((e) => (e.variant_id ? { product_id: e.product_id, variant_id: e.variant_id } : { product_id: e.product_id })) })
    clearLocalWishlist()
  } catch {
    // Kept locally; retried on the next sign-in.
  }
}

function refreshCustomerData(queryClient: QueryClient, customer: Customer | null) {
  if (customer) queryClient.setQueryData(customerKeys.me, customer)
  else void queryClient.invalidateQueries({ queryKey: customerKeys.me })
  queryClient.removeQueries({ queryKey: customerKeys.profile })
  queryClient.removeQueries({ queryKey: customerKeys.addresses })
  queryClient.removeQueries({ queryKey: accountKeys.orders })
  queryClient.removeQueries({ queryKey: accountKeys.reviews })
  void queryClient.invalidateQueries({ queryKey: customerKeys.wishlist })
  void queryClient.invalidateQueries({ queryKey: customerKeys.cart })
}

export const CAPPED_NOTICE = 'Some items from your earlier cart were reduced to the quantity in stock. Please check your cart.'

function useSignInCompletion() {
  const queryClient = useQueryClient()
  const notice = useNotice()
  return (result: SignInResult) => {
    refreshCustomerData(queryClient, result.customer)
    if (result.merge && result.merge.capped_lines > 0) notice(CAPPED_NOTICE)
  }
}

export function useLoginMutation() {
  const complete = useSignInCompletion()
  return useMutation({
    mutationFn: async (input: LoginInput) => {
      const result = (await storeApi.post<SignInResult>('/store/account/login', input)).data
      await mergeLocalWishlist()
      return result
    },
    onSuccess: complete,
  })
}

export function useRegisterMutation() {
  const complete = useSignInCompletion()
  return useMutation({
    mutationFn: async (input: RegisterInput) => {
      const result = (await storeApi.post<SignInResult>('/store/account/register', input)).data
      await mergeLocalWishlist()
      return result
    },
    onSuccess: complete,
  })
}

/** Sign-out; an account page that is open then sends the visitor to the home page (RequireCustomer). */
export function useLogoutMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => storeApi.post<void>('/store/account/logout'),
    onSuccess: () => {
      queryClient.setQueryData(customerKeys.me, null)
      queryClient.removeQueries({ queryKey: customerKeys.profile })
      queryClient.removeQueries({ queryKey: customerKeys.addresses })
      queryClient.removeQueries({ queryKey: customerKeys.wishlist })
      queryClient.removeQueries({ queryKey: accountKeys.orders })
      queryClient.removeQueries({ queryKey: accountKeys.reviews })
      void queryClient.invalidateQueries({ queryKey: customerKeys.cart })
    },
  })
}

type MaybeMessage = { message?: string } | null | undefined

export const FORGOT_PASSWORD_SENT = 'If an account exists for this e-mail address, we have sent a link to reset the password. Please check your inbox.'

export function useForgotPasswordMutation() {
  return useMutation({
    mutationFn: (email: string) => storeApi.post<MaybeMessage>('/store/account/forgot-password', { email }).then((r) => r.data),
  })
}

export type ResetPasswordInput = { email: string; token: string; password: string; password_confirmation: string }

/** A successful reset signs the customer in. */
export function useResetPasswordMutation() {
  const queryClient = useQueryClient()
  const complete = useSignInCompletion()
  return useMutation({
    mutationFn: async (input: ResetPasswordInput) => {
      const data = (await storeApi.post<Partial<SignInResult> | null>('/store/account/reset-password', input)).data
      await mergeLocalWishlist()
      return data
    },
    onSuccess: (data) => {
      if (data?.customer) complete({ customer: data.customer, merge: data.merge ?? null })
      else refreshCustomerData(queryClient, null)
    },
  })
}

export function useVerifyEmailMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (token: string) => storeApi.post<MaybeMessage>('/store/account/verify-email', { token }).then((r) => r.data),
    onSuccess: () => {
      const me = queryClient.getQueryData<Customer | null>(customerKeys.me)
      if (me) queryClient.setQueryData(customerKeys.me, { ...me, email_verified: true })
      void queryClient.invalidateQueries({ queryKey: customerKeys.me })
    },
  })
}

export function useResendVerificationMutation() {
  return useMutation({ mutationFn: () => storeApi.post<MaybeMessage>('/store/account/verification-notification').then((r) => r.data) })
}

/* Profile ------------------------------------------------------------------------------ */

export type ProfileInput = { name: string; phone: string | null }

export function useProfileQuery() {
  return useQuery({
    queryKey: customerKeys.profile,
    queryFn: ({ signal }) => storeApi.get<Customer>('/store/account/profile', { signal }).then((r) => r.data),
  })
}

export function useUpdateProfileMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: ProfileInput) => storeApi.put<Customer>('/store/account/profile', input).then((r) => r.data),
    onSuccess: (profile, input) => {
      if (profile) queryClient.setQueryData(customerKeys.profile, profile)
      const me = queryClient.getQueryData<Customer | null>(customerKeys.me)
      if (me) queryClient.setQueryData(customerKeys.me, { ...me, name: profile?.name ?? input.name, phone: profile?.phone ?? input.phone })
      void queryClient.invalidateQueries({ queryKey: customerKeys.profile })
    },
  })
}

export type PasswordInput = { current_password: string; password: string; password_confirmation: string }

export function useChangePasswordMutation() {
  return useMutation({ mutationFn: (input: PasswordInput) => storeApi.put<MaybeMessage>('/store/account/password', input).then((r) => r.data) })
}

/* Addresses ---------------------------------------------------------------------------- */

export const MAX_ADDRESSES = 10

export function useAddressesQuery(enabled = true) {
  return useQuery({
    queryKey: customerKeys.addresses,
    queryFn: ({ signal }) => storeApi.get<CustomerAddress[]>('/store/account/addresses', { signal }).then((r) => r.data),
    enabled,
  })
}

/** Creates (no id) or updates an address; defaults may move between addresses, so the list is refetched. */
export function useSaveAddressMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: Partial<AddressInput> }) =>
      (id ? storeApi.patch<CustomerAddress>(`/store/account/addresses/${encodeURIComponent(id)}`, input) : storeApi.post<CustomerAddress>('/store/account/addresses', input)).then((r) => r.data),
    onSettled: () => queryClient.invalidateQueries({ queryKey: customerKeys.addresses }),
  })
}

export function useDeleteAddressMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => storeApi.delete(`/store/account/addresses/${encodeURIComponent(id)}`),
    onSettled: () => queryClient.invalidateQueries({ queryKey: customerKeys.addresses }),
  })
}

/* Geography (public, cached for a day by the server) ------------------------------------ */

export function useDivisionsQuery() {
  return useQuery({
    queryKey: customerKeys.divisions,
    queryFn: ({ signal }) => storeApi.get<GeoDivision[]>('/store/geo/divisions', { signal }).then((r) => r.data),
    staleTime: Infinity,
  })
}

export function useDistrictsQuery(divisionId: string) {
  return useQuery({
    queryKey: customerKeys.districts(divisionId),
    queryFn: ({ signal }) => storeApi.get<GeoDistrict[]>('/store/geo/districts', { signal, query: { division: divisionId } }).then((r) => r.data),
    enabled: divisionId !== '',
    staleTime: Infinity,
  })
}
