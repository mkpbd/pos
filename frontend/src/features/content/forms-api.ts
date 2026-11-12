import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, toPaginated, type ApiMeta, type Paginated } from '@/lib/api/client'

/**
 * Form submissions (B8b): what visitors sent with the builder `form` element. Read with
 * `forms.view` (incl. export); mark read / archive and delete with `forms.manage`.
 */

export type FormSubmissionStatus = 'new' | 'read' | 'archived'
export const FORM_SUBMISSION_STATUSES: FormSubmissionStatus[] = ['new', 'read', 'archived']
export const FORM_SUBMISSION_STATUS_LABELS: Record<FormSubmissionStatus, string> = { new: 'New', read: 'Read', archived: 'Archived' }

export type FormFieldKind = 'text' | 'email' | 'phone' | 'textarea' | 'number' | 'select' | 'radio' | 'checkbox' | 'checkboxes' | 'date'

/** A form as `GET /forms` lists it: one per (builder document, form element) that has submissions. */
export type FormSummary = {
  document_id: string
  element_id: string
  title: string
  /** The page, popup or zone the form lives in (admin name). */
  document_title?: string | null
  document_kind?: string | null
  total: number
  new: number
  last_submitted_at?: string | null
}

/** The field list as it was when the visitor submitted (labels in the submission's language). */
export type FormSubmissionField = { id: string; label: string; kind: FormFieldKind | string }
export type FormSubmissionValue = string | number | boolean | string[] | null

export type FormSubmission = {
  id: string
  document_id: string
  element_id: string
  form_title: string
  document_title?: string | null
  fields: FormSubmissionField[]
  values: Record<string, FormSubmissionValue>
  reply_to: string | null
  locale: string | null
  page_path: string | null
  status: FormSubmissionStatus
  read_at: string | null
  read_by?: { id: string; name: string | null } | null
  created_at: string | null
  updated_at?: string | null
  /** Detail only. */
  ip?: string | null
  user_agent?: string | null
}

/** `form` = "<document_id>:<element_id>". `from` / `to` are dates (YYYY-MM-DD). */
export type FormSubmissionListParams = { page: number; form?: string; status?: FormSubmissionStatus; search?: string; from?: string; to?: string }
export type FormStatusCounts = Partial<Record<FormSubmissionStatus, number>>

export const formKey = (form: Pick<FormSummary, 'document_id' | 'element_id'>) => `${form.document_id}:${form.element_id}`

export const formKeys = {
  all: ['forms'] as const,
  forms: ['forms', 'list'] as const,
  submissions: ['forms', 'submissions'] as const,
  submissionList: (params: FormSubmissionListParams) => ['forms', 'submissions', 'list', params] as const,
  submission: (id: string) => ['forms', 'submissions', id] as const,
}

export function useFormsQuery() {
  return useQuery({
    queryKey: formKeys.forms,
    queryFn: ({ signal }) => api.get<FormSummary[]>('/forms', { signal }).then((r) => r.data),
  })
}

export function useFormSubmissionsQuery(params: FormSubmissionListParams) {
  return useQuery({
    queryKey: formKeys.submissionList(params),
    queryFn: ({ signal }) =>
      api.get<FormSubmission[]>('/forms/submissions', { signal, query: params }).then(
        (r): Paginated<FormSubmission> & { counts: FormStatusCounts | null } => ({
          ...toPaginated(r),
          counts: (r.meta as ApiMeta & { status_counts?: FormStatusCounts }).status_counts ?? null,
        }),
      ),
    placeholderData: (previous) => previous,
  })
}

export function useFormSubmissionQuery(id: string | undefined) {
  return useQuery({
    queryKey: formKeys.submission(id ?? ''),
    queryFn: ({ signal }) => api.get<FormSubmission>(`/forms/submissions/${id}`, { signal }).then((r) => r.data),
    enabled: id !== undefined,
  })
}

export function useSetFormSubmissionStatusMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: FormSubmissionStatus }) => api.patch<FormSubmission>(`/forms/submissions/${id}`, { status }).then((r) => r.data),
    onSuccess: (submission) => {
      queryClient.setQueryData(formKeys.submission(submission.id), submission)
      void queryClient.invalidateQueries({ queryKey: formKeys.forms })
      return queryClient.invalidateQueries({ queryKey: [...formKeys.submissions, 'list'] })
    },
  })
}

export function useDeleteFormSubmissionMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => api.delete(`/forms/submissions/${id}`),
    onSuccess: (_data, id) => {
      queryClient.removeQueries({ queryKey: formKeys.submission(id) })
      void queryClient.invalidateQueries({ queryKey: formKeys.forms })
      return queryClient.invalidateQueries({ queryKey: [...formKeys.submissions, 'list'] })
    },
  })
}
