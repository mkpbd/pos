import type { Backup } from '@/features/system/api'

/** A run the page asked for and waits on (the job is queued, so its row appears or changes a moment later). */
export type BackupWatch =
  | { kind: 'backup'; previousNewestId: string | null; backupId?: string | null }
  | { kind: 'verify'; backupId: string; previousVerifiedAt: string | null }

/** Give up waiting (and polling) after this long; the list can still be refreshed by hand. */
export const WATCH_TIMEOUT_MS = 10 * 60_000

/** The finished row the watch was waiting for, or null while it is still pending. */
export function settledRow(watch: BackupWatch, items: Backup[]): Backup | null {
  if (watch.kind === 'backup' && watch.backupId) {
    // The server answered with the queued run's row: wait for that one.
    const row = items.find((b) => b.id === watch.backupId)
    return row && row.status !== 'running' ? row : null
  }
  if (watch.kind === 'backup') {
    const newest = items[0]
    return newest && newest.id !== watch.previousNewestId && newest.status !== 'running' ? newest : null
  }
  const row = items.find((b) => b.id === watch.backupId)
  return row && row.verified_at && row.verified_at !== watch.previousVerifiedAt ? row : null
}
