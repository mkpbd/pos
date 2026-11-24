import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { ApiError } from '@/lib/api/client'
import { storeApi } from '../http'
import { useLocale } from '../i18n/locale'
import { useNotice } from '../notices'
import { accountKeys, customerKeys, localized, setLocalizedData } from '../store-keys'
import type { AddressInput, Customer, CustomerAddress, GeoDistrict, GeoDivision, PhoneCodeSent, PhoneSignInResult, SignInResult } from '../types'
import { clearLocalWishlist, readLocalWishlist } from '../wishlist/local-wishlist'

/** The signed-in customer, null for guests (GET /store/account/me also issues the CSRF cookie). */
export function useMeQuery(enabled = true) {
  const { locale } = useLocale()
  return useQuery({
    queryKey: localized(customerKeys.me, locale),
    enabled,
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

function refreshCustomerData(queryClient: QueryClient, locale: string, customer: Customer | null) {
  if (customer) setLocalizedData(queryClient, customerKeys.me, locale, customer)
  else void queryClient.invalidateQueries({ queryKey: customerKeys.me })
  queryClient.removeQueries({ queryKey: customerKeys.profile })
  queryClient.removeQueries({ queryKey: customerKeys.addresses })
  queryClient.removeQueries({ queryKey: accountKeys.orders })
  queryClient.removeQueries({ queryKey: accountKeys.reviews })
  void queryClient.invalidateQueries({ queryKey: customerKeys.wishlist })
  void queryClient.invalidateQueries({ queryKey: customerKeys.cart })
}

/** Shown after sign-in when the merged guest cart had to be capped to the stock. */
export const CAPPED_NOTICE_KEY = 'account.notice.capped'

function useSignInCompletion() {
  const queryClient = useQueryClient()
  const notice = useNotice()
  const { locale, t } = useLocale()
  return (result: SignInResult) => {
    refreshCustomerData(queryClient, locale, result.customer)
    if (result.merge && result.merge.capped_lines > 0) notice(t(CAPPED_NOTICE_KEY))
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

/* Phone sign-in (BD1a) ------------------------------------------------------------------ */

export type PhoneCodePurpose = 'login' | 'verify_phone'

/** POST /store/account/otp/send (202): a code by SMS — the same answer whether an account exists. */
export function sendAccountCode(phone: string, purpose: PhoneCodePurpose): Promise<PhoneCodeSent> {
  return storeApi.post<PhoneCodeSent>('/store/account/otp/send', { phone, purpose }).then((r) => r.data)
}

export type PhoneLoginInput = { phone: string; code: string; remember: boolean }

/** POST /store/account/otp/login: signs in the account whose verified number this is, or asks for a name (`needs_profile`). */
export function usePhoneLoginMutation() {
  const complete = useSignInCompletion()
  return useMutation({
    mutationFn: async (input: PhoneLoginInput) => {
      const result = (await storeApi.post<PhoneSignInResult>('/store/account/otp/login', input)).data
      if (result.status === 'signed_in') await mergeLocalWishlist()
      return result
    },
    onSuccess: (result) => {
      if (result.status === 'signed_in') complete({ customer: result.customer, merge: result.merge ?? null })
    },
  })
}

export type PhoneRegisterInput = { name: string; email?: string | null }

/** POST /store/account/otp/register (201 profile): creates the account for the confirmed number and signs in. */
export function usePhoneRegisterMutation() {
  const complete = useSignInCompletion()
  return useMutation({
    mutationFn: async (input: PhoneRegisterInput) => {
      const customer = (await storeApi.post<Customer>('/store/account/otp/register', input)).data
      await mergeLocalWishlist()
      return customer
    },
    onSuccess: (customer) => complete({ customer, merge: null }),
  })
}

/** Sign-out; an account page that is open then sends the visitor to the home page (RequireCustomer). */
export function useLogoutMutation() {
  const queryClient = useQueryClient()
  const { locale } = useLocale()
  return useMutation({
    mutationFn: () => storeApi.post<void>('/store/account/logout'),
    onSuccess: () => {
      setLocalizedData(queryClient, customerKeys.me, locale, null)
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

export function useForgotPasswordMutation() {
  return useMutation({
    mutationFn: (email: string) => storeApi.post<MaybeMessage>('/store/account/forgot-password', { email }).then((r) => r.data),
  })
}

export type ResetPasswordInput = { email: string; token: string; password: string; password_confirmation: string }

/** A successful reset signs the customer in. */
export function useResetPasswordMutation() {
  const queryClient = useQueryClient()
  const { locale } = useLocale()
  const complete = useSignInCompletion()
  return useMutation({
    mutationFn: async (input: ResetPasswordInput) => {
      const data = (await storeApi.post<Partial<SignInResult> | null>('/store/account/reset-password', input)).data
      await mergeLocalWishlist()
      return data
    },
    onSuccess: (data) => {
      if (data?.customer) complete({ customer: data.customer, merge: data.merge ?? null })
      else refreshCustomerData(queryClient, locale, null)
    },
  })
}

export function useVerifyEmailMutation() {
  const queryClient = useQueryClient()
  const { locale } = useLocale()
  return useMutation({
    mutationFn: (token: string) => storeApi.post<MaybeMessage>('/store/account/verify-email', { token }).then((r) => r.data),
    onSuccess: () => {
      const me = queryClient.getQueryData<Customer | null>(localized(customerKeys.me, locale))
      if (me) setLocalizedData(queryClient, customerKeys.me, locale, { ...me, email_verified: true })
      void queryClient.invalidateQueries({ queryKey: customerKeys.me })
    },
  })
}

export function useResendVerificationMutation() {
  return useMutation({ mutationFn: () => storeApi.post<MaybeMessage>('/store/account/verification-notification').then((r) => r.data) })
}

/* Profile ------------------------------------------------------------------------------ */

/** `email` only while the account has none (BD1a: it can be added once). */
export type ProfileInput = { name: string; phone: string | null; email?: string }

export function useProfileQuery() {
  const { locale } = useLocale()
  return useQuery({
    queryKey: localized(customerKeys.profile, locale),
    queryFn: ({ signal }) => storeApi.get<Customer>('/store/account/profile', { signal }).then((r) => r.data),
  })
}

export function useUpdateProfileMutation() {
  const queryClient = useQueryClient()
  const { locale } = useLocale()
  return useMutation({
    mutationFn: (input: ProfileInput) => storeApi.put<Customer>('/store/account/profile', input).then((r) => r.data),
    onSuccess: (profile, input) => {
      if (profile) setLocalizedData(queryClient, customerKeys.profile, locale, profile)
      const me = queryClient.getQueryData<Customer | null>(localized(customerKeys.me, locale))
      if (me) setLocalizedData(queryClient, customerKeys.me, locale, profile ? { ...me, ...profile } : { ...me, name: input.name, phone: input.phone })
      void queryClient.invalidateQueries({ queryKey: customerKeys.profile })
    },
  })
}

/** POST /store/account/profile/phone (BD1a): the code confirms the number, which becomes the account's verified one. */
export function useVerifyProfilePhoneMutation() {
  const queryClient = useQueryClient()
  const { locale } = useLocale()
  return useMutation({
    mutationFn: (input: { phone: string; code: string }) => storeApi.post<Customer | null>('/store/account/profile/phone', input).then((r) => r.data),
    onSuccess: (profile, input) => {
      const patch = profile && typeof profile === 'object' && 'id' in profile ? profile : { phone: input.phone, phone_verified: true }
      for (const key of [customerKeys.profile, customerKeys.me]) {
        const current = queryClient.getQueryData<Customer | null>(localized(key, locale))
        if (current) setLocalizedData(queryClient, key, locale, { ...current, ...patch })
      }
      void queryClient.invalidateQueries({ queryKey: customerKeys.profile })
      void queryClient.invalidateQueries({ queryKey: customerKeys.me })
    },
  })
}

/** Without `current_password` when the account has no password yet (BD1a: the first password of a phone-only account). */
export type PasswordInput = { current_password?: string; password: string; password_confirmation: string }

export function useChangePasswordMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: PasswordInput) => storeApi.put<MaybeMessage>('/store/account/password', input).then((r) => r.data),
    onSuccess: (_data, input) => {
      if (input.current_password === undefined) {
        void queryClient.invalidateQueries({ queryKey: customerKeys.profile })
        void queryClient.invalidateQueries({ queryKey: customerKeys.me })
      }
    },
  })
}

/* Addresses ---------------------------------------------------------------------------- */

export const MAX_ADDRESSES = 10

export function useAddressesQuery(enabled = true) {
  const { locale } = useLocale()
  return useQuery({
    queryKey: localized(customerKeys.addresses, locale),
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
  const { locale } = useLocale()
  return useQuery({
    queryKey: localized(customerKeys.divisions, locale),
    queryFn: ({ signal }) => storeApi.get<GeoDivision[]>('/store/geo/divisions', { signal }).then((r) => r.data),
    staleTime: Infinity,
  })
}

export function useDistrictsQuery(divisionId: string) {
  const { locale } = useLocale()
  return useQuery({
    queryKey: localized(customerKeys.districts(divisionId), locale),
    queryFn: ({ signal }) => storeApi.get<GeoDistrict[]>('/store/geo/districts', { signal, query: { division: divisionId } }).then((r) => r.data),
    enabled: divisionId !== '',
    staleTime: Infinity,
  })
}
