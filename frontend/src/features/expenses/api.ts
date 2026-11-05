import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, toPaginated, type ApiMeta, type Paginated } from '@/lib/api/client'
import { useInvalidateMoney as useInvalidateLedger } from '@/features/payments/api'
import type { MoneyMethod } from '@/lib/payment-methods'

/** Expenses pay money out; other income (e.g. scrap sales, rent received) brings it in. */
export type EntryType = 'expense' | 'income'

export type ExpenseCategory = { id: string; type: EntryType; name: string; is_active: boolean }

type Person = { id: string; name: string | null }

export type Expense = {
  id: string
  type: EntryType
  number: string
  branch: { id: string; name: string } | null
  category: { id: string; name: string | null }
  currency: string
  amount: string
  method: MoneyMethod
  method_label: string
  reference: string | null
  party: string | null
  occurred_on: string
  notes: string | null
  created_by: Person | null
  created_at: string
  voided_at: string | null
  voided_by: Person | null
  void_reason: string | null
}

export type ExpenseInput = {
  type: EntryType
  branch_id: string
  expense_category_id: string
  amount: string
  method: MoneyMethod
  occurred_on: string
  reference: string | null
  party: string | null
  notes: string | null
}

export type ExpensesParams = {
  page: number
  type: EntryType
  branch_id?: string
  expense_category_id?: string
  method?: MoneyMethod
  from?: string
  to?: string
  voided?: boolean
  search?: string
}

export type ExpensesPage = Paginated<Expense> & {
  total: string | null
  byCategory: { id: string; name: string | null; total: string; entries: number }[]
}

export const ENTRY_TYPES: Record<EntryType, { label: string; plural: string; prefix: string }> = {
  expense: { label: 'Expense', plural: 'Expenses', prefix: 'EXP' },
  income: { label: 'Income', plural: 'Other income', prefix: 'INC' },
}

export const expensesKeys = {
  all: ['expenses'] as const,
  list: (params: ExpensesParams) => ['expenses', 'list', params] as const,
  categories: (type?: EntryType) => ['expenses', 'categories', type ?? 'all'] as const,
}

/** Query string of GET /expenses — shared by the list and its export. */
export function expensesListQuery(params: Omit<ExpensesParams, 'page'> & { page?: number }) {
  return { ...params, voided: params.voided ? 'true' : undefined, sort: '-occurred_on' }
}

export function useExpensesQuery(params: ExpensesParams) {
  return useQuery<ExpensesPage>({
    queryKey: expensesKeys.list(params),
    queryFn: ({ signal }) =>
      api.get<Expense[]>('/expenses', { signal, query: expensesListQuery(params) }).then((res) => {
        const meta = res.meta as ApiMeta & { totals?: { amount: string }; by_category?: ExpensesPage['byCategory'] }
        return { ...toPaginated(res), total: meta.totals?.amount ?? null, byCategory: meta.by_category ?? [] }
      }),
    placeholderData: (previous) => previous,
  })
}

export function useExpenseCategoriesQuery(type?: EntryType) {
  return useQuery({
    queryKey: expensesKeys.categories(type),
    queryFn: ({ signal }) => api.get<ExpenseCategory[]>('/expense-categories', { signal, query: { type } }).then((r) => r.data),
  })
}

/** Money moved: the ledger, and the cash drawer when paid in cash. */
function useInvalidateMoney() {
  const queryClient = useQueryClient()
  const invalidateLedger = useInvalidateLedger()
  return () => {
    void queryClient.invalidateQueries({ queryKey: expensesKeys.all, predicate: (q) => q.queryKey[1] === 'list' })
    invalidateLedger()
  }
}

/** Idempotent: pass the same key when retrying the same entry. */
export function useCreateExpenseMutation() {
  const invalidate = useInvalidateMoney()
  return useMutation({
    mutationFn: ({ input, idempotencyKey }: { input: ExpenseInput; idempotencyKey: string }) =>
      api.post<Expense>('/expenses', input, { idempotencyKey }).then((r) => r.data),
    onSuccess: invalidate,
  })
}

export function useVoidExpenseMutation() {
  const invalidate = useInvalidateMoney()
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => api.post<Expense>(`/expenses/${id}/void`, { reason }).then((r) => r.data),
    onSuccess: invalidate,
  })
}

export function useSaveExpenseCategoryMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: Partial<Omit<ExpenseCategory, 'id'>> }) =>
      (id ? api.put<ExpenseCategory>(`/expense-categories/${id}`, input) : api.post<ExpenseCategory>('/expense-categories', input)).then((r) => r.data),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: expensesKeys.all, predicate: (q) => q.queryKey[1] === 'categories' }),
  })
}

export function useDeleteExpenseCategoryMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.delete(`/expense-categories/${id}`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: expensesKeys.all, predicate: (q) => q.queryKey[1] === 'categories' }),
  })
}
