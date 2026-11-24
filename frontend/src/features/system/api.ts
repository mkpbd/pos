import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, toPaginated } from '@/lib/api/client'

export type CheckStatus = 'ok' | 'fail'

export type SystemHealth = {
  status: 'ok' | 'degraded'
  checks: Record<string, CheckStatus>
  app: string
  environment: string
  time: string
}

/* ------------------------------------------------------------------ G1b operations (platform admins) */

/** Bigint columns may arrive as JSON numbers or numeric strings. */
export type Count = number | string

export type RetentionRun = {
  last_run_at: string | null
  deleted: Record<string, Count>
}

export type BackupsCheck = {
  status: 'ok' | 'warn' | 'fail' | 'disabled'
  enabled: boolean
  last_success_at: string | null
  last_file: string | null
  last_size_bytes: Count | null
  last_verified_at: string | null
  verify_status: 'passed' | 'failed' | null
  last_failure_at: string | null
  /** The configured daily time (POS_BACKUP_TIME, app timezone); `keep_days` only if the server reports it. */
  schedule_time?: string | null
  keep_days?: number | null
}

export type SystemStatusReport = {
  checks: {
    database: CheckStatus
    cache: CheckStatus
    scheduler: { status: 'ok' | 'stale' | 'unknown'; last_heartbeat_at: string | null }
    queue: {
      status: 'ok' | 'stale' | 'unknown' | 'sync'
      driver: string
      last_heartbeat_at: string | null
      pending_jobs: Count | null
      failed_jobs: Count
    }
    mail: { status: 'ok' | 'warn'; mailer: string; from_address: string | null }
    backups: BackupsCheck
    storage: { status: 'ok' | 'warn'; path: string; free_bytes: Count | null; total_bytes: Count | null }
    errors: { open: Count; new_last_24h: Count }
    retention?: RetentionRun | null
  }
  app: { environment: string; debug: boolean; php_version: string; laravel_version: string; timezone: string }
  warnings: { code: string; message: string }[]
  retention?: RetentionRun | null
}

export type Backup = {
  id: string
  started_at: string
  finished_at: string | null
  status: 'running' | 'succeeded' | 'failed'
  file_name: string | null
  size_bytes: Count | null
  sha256: string | null
  error: string | null
  offsite_status: 'skipped' | 'succeeded' | 'failed' | null
  offsite_error: string | null
  verified_at: string | null
  verify_status: 'passed' | 'failed' | null
  verify_error: string | null
  verify_mode: 'list' | 'restore' | null
  triggered_by: 'schedule' | 'user'
  user_id: string | null
  /** Set when backup retention deleted the file (the row stays for history). */
  file_deleted_at?: string | null
}

export type FailedJob = {
  id: number | string
  uuid: string
  job: string
  queue: string
  connection: string
  failed_at: string | null
  exception: string
}

export type ErrorStatus = 'open' | 'resolved' | 'ignored'

export type ErrorEvent = {
  id: string
  exception_class: string
  message: string
  file: string | null
  line: number | null
  occurrences: Count
  first_seen_at: string
  last_seen_at: string
  last_method: string | null
  last_path: string | null
  last_request_id: string | null
  status: ErrorStatus
  resolved_at: string | null
}

export type ErrorEventDetail = ErrorEvent & { trace: string | null }

export type ErrorSort = '-last_seen_at' | '-occurrences'

export type ErrorListParams = { status: ErrorStatus; search?: string; sort: ErrorSort; page: number }

const PLATFORM = '/platform/system'

export const systemKeys = {
  health: ['system', 'health'] as const,
  ops: ['system', 'ops'] as const,
  status: ['system', 'ops', 'status'] as const,
  backups: ['system', 'ops', 'backups'] as const,
  failedJobs: ['system', 'ops', 'failed-jobs'] as const,
  errors: ['system', 'ops', 'errors'] as const,
  error: (id: string) => ['system', 'ops', 'errors', 'detail', id] as const,
}

export function fetchHealth(signal?: AbortSignal): Promise<SystemHealth> {
  return api.get<SystemHealth>('/health', { signal }).then((res) => res.data)
}

export function useHealthQuery() {
  return useQuery({
    queryKey: systemKeys.health,
    queryFn: ({ signal }) => fetchHealth(signal),
    refetchInterval: 30_000,
  })
}

/** GET /platform/system/status — refreshed on demand (and after a backup finishes), never on a timer. */
export function useSystemStatusQuery() {
  return useQuery({
    queryKey: systemKeys.status,
    queryFn: ({ signal }) => api.get<SystemStatusReport>(`${PLATFORM}/status`, { signal }).then((r) => r.data),
  })
}

/** Rows are polled every few seconds only while one is running or the page waits for a requested run. */
export const BACKUP_POLL_MS = 3000

export function useBackupsQuery(page: number, waiting: boolean) {
  return useQuery({
    queryKey: [...systemKeys.backups, page],
    queryFn: ({ signal }) => api.get<Backup[]>(`${PLATFORM}/backups`, { signal, query: { page } }).then(toPaginated),
    placeholderData: (previous) => previous,
    refetchInterval: (query) => (waiting || query.state.data?.items.some((b) => b.status === 'running') ? BACKUP_POLL_MS : false),
  })
}

export function useRunBackupMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    // 202 with the queued run's row (status running) when the server creates it up front.
    mutationFn: () => api.post<Partial<Backup> | null>(`${PLATFORM}/backups`).then((r) => r.data),
    onSettled: () => queryClient.invalidateQueries({ queryKey: systemKeys.backups }),
  })
}

export function useVerifyBackupMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.post<unknown>(`${PLATFORM}/backups/${id}/verify`).then((r) => r.data),
    onSettled: () => queryClient.invalidateQueries({ queryKey: systemKeys.backups }),
  })
}

export function useSendTestMailMutation() {
  return useMutation({
    mutationFn: (to: string) => api.post<{ sent: boolean }>(`${PLATFORM}/mail-test`, { to }).then((r) => r.data),
  })
}

export function useFailedJobsQuery(page: number) {
  return useQuery({
    queryKey: [...systemKeys.failedJobs, page],
    queryFn: ({ signal }) => api.get<FailedJob[]>(`${PLATFORM}/failed-jobs`, { signal, query: { page } }).then(toPaginated),
    placeholderData: (previous) => previous,
  })
}

/** Retrying or deleting changes the list and the failed-job count in the status report. */
function useFailedJobMutation<TInput>(request: (input: TInput) => Promise<unknown>) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: request,
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: systemKeys.failedJobs }),
        queryClient.invalidateQueries({ queryKey: systemKeys.status }),
      ]),
  })
}

export function useRetryFailedJobMutation() {
  return useFailedJobMutation((uuid: string) => api.post(`${PLATFORM}/failed-jobs/${uuid}/retry`))
}

export function useDeleteFailedJobMutation() {
  return useFailedJobMutation((uuid: string) => api.delete(`${PLATFORM}/failed-jobs/${uuid}`))
}

export function useRetryAllFailedJobsMutation() {
  return useFailedJobMutation(() => api.post<unknown>(`${PLATFORM}/failed-jobs/retry-all`).then((r) => r.data))
}

export function useErrorEventsQuery(params: ErrorListParams) {
  return useQuery({
    queryKey: [...systemKeys.errors, 'list', params],
    queryFn: ({ signal }) => api.get<ErrorEvent[]>(`${PLATFORM}/errors`, { signal, query: params }).then(toPaginated),
    placeholderData: (previous) => previous,
  })
}

export function useErrorEventQuery(id: string) {
  return useQuery({
    queryKey: systemKeys.error(id),
    queryFn: ({ signal }) => api.get<ErrorEventDetail>(`${PLATFORM}/errors/${id}`, { signal }).then((r) => r.data),
  })
}

export function useSetErrorStatusMutation(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (status: ErrorStatus) => api.patch<ErrorEventDetail>(`${PLATFORM}/errors/${id}`, { status }).then((r) => r.data),
    onSuccess: (updated) => {
      // The list answers without the trace; keep the one already loaded if the PATCH omits it.
      queryClient.setQueryData<ErrorEventDetail>(systemKeys.error(id), (current) => (current ? { ...current, ...updated, trace: updated.trace ?? current.trace } : updated))
      return Promise.all([
        queryClient.invalidateQueries({ queryKey: [...systemKeys.errors, 'list'] }),
        queryClient.invalidateQueries({ queryKey: systemKeys.status }),
      ])
    },
  })
}
