/** Searchable record lists (by param entity) behind the product / customer / supplier / cashier report filters. */

export type Hit = { id: string; name: string; hint: string | null }

export type EntitySource = {
  /** Permission needed to search the list endpoint (mirrors its route guard). */
  permission: string
  list: string
  detail: (id: string) => string
  noun: string
  placeholder: string
  describe: (record: Record<string, unknown>) => Hit
}

const str = (v: unknown) => (typeof v === 'string' && v !== '' ? v : null)

export const ENTITY_SOURCES: Record<string, EntitySource> = {
  product: {
    permission: 'products.view',
    list: '/products',
    detail: (id) => `/products/${id}`,
    noun: 'product',
    placeholder: 'Search name, SKU or barcode',
    describe: (r) => ({ id: String(r.id), name: String(r.name ?? ''), hint: str((r.variants as { sku?: string }[] | undefined)?.[0]?.sku) }),
  },
  customer: {
    permission: 'customers.view',
    list: '/customers',
    detail: (id) => `/customers/${id}`,
    noun: 'customer',
    placeholder: 'Name, phone or code',
    describe: (r) => ({ id: String(r.id), name: String(r.name ?? ''), hint: [str(r.code), str(r.phone)].filter(Boolean).join(' · ') || null }),
  },
  supplier: {
    permission: 'suppliers.view',
    list: '/suppliers',
    detail: (id) => `/suppliers/${id}`,
    noun: 'supplier',
    placeholder: 'Name or code',
    describe: (r) => ({ id: String(r.id), name: String(r.name ?? ''), hint: str(r.code) }),
  },
  cashier: {
    permission: 'users.view',
    list: '/users',
    detail: (id) => `/users/${id}`,
    noun: 'cashier',
    placeholder: 'Name or email',
    describe: (r) => ({ id: String(r.id), name: String(r.name ?? ''), hint: str(r.email) }),
  },
}
