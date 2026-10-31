/** Query keys of the customer-specific storefront data (E7); sign-in and sign-out refresh them together. */
export const customerKeys = {
  me: ['store', 'account', 'me'] as const,
  profile: ['store', 'account', 'profile'] as const,
  addresses: ['store', 'account', 'addresses'] as const,
  cart: ['store', 'cart'] as const,
  wishlist: ['store', 'wishlist'] as const,
  divisions: ['store', 'geo', 'divisions'] as const,
  districts: (division: string) => ['store', 'geo', 'districts', division] as const,
}
