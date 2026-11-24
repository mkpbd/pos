import { describe, expect, it } from 'vitest'
import { settledRow } from '@/features/system/backup-watch'
import { formatBytes, formatCount, formatRelative, toNumber } from '@/features/system/format'
import { shortClass, statusLabel, tableLabel, verifyLabel, warningTitle } from '@/features/system/labels'
import { makeBackup } from '@/features/system/testing'

const NOW = Date.parse('2026-11-24T10:00:00Z')

describe('formatBytes', () => {
  it('uses binary units with one decimal below ten', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(340 * 1024)).toBe('340 KB')
    expect(formatBytes(1.25 * 1024 ** 3)).toBe('1.3 GB')
    expect(formatBytes('52428800')).toBe('50 MB')
    expect(formatBytes(null)).toBe('—')
  })
})

describe('formatRelative', () => {
  it('reads like a person would say it', () => {
    expect(formatRelative('2026-11-24T09:59:30Z', NOW)).toBe('just now')
    expect(formatRelative('2026-11-24T09:58:00Z', NOW)).toBe('2 min ago')
    expect(formatRelative('2026-11-24T07:00:00Z', NOW)).toBe('3 h ago')
    expect(formatRelative('2026-11-23T08:00:00Z', NOW)).toBe('yesterday')
    expect(formatRelative('2026-11-19T10:00:00Z', NOW)).toBe('5 days ago')
    expect(formatRelative(null, NOW)).toBe('never')
  })

  it('treats a server clock slightly ahead as now', () => {
    expect(formatRelative('2026-11-24T10:00:40Z', NOW)).toBe('just now')
  })
})

describe('numbers', () => {
  it('accepts bigint strings', () => {
    expect(toNumber('1234')).toBe(1234)
    expect(toNumber('x')).toBeNull()
    expect(formatCount('12345')).toBe('12,345')
  })
})

describe('labels', () => {
  it('words statuses, warnings, tables and classes', () => {
    expect(statusLabel('stale')).toEqual({ label: 'Stale', variant: 'warning' })
    expect(statusLabel('sync').label).toBe('Inline (sync)')
    expect(warningTitle('SCHEDULER_STALE')).toBe('The scheduler is not running')
    expect(warningTitle('SOMETHING_NEW')).toBeNull()
    expect(tableLabel('login_activities')).toBe('Login activities')
    expect(shortClass('Illuminate\\Database\\QueryException')).toBe('QueryException')
    expect(verifyLabel('passed', 'restore').label).toBe('Restore passed')
    expect(verifyLabel(null, null).label).toBe('Not verified')
  })
})

describe('settledRow', () => {
  it('waits for a new, finished backup row', () => {
    const watch = { kind: 'backup' as const, previousNewestId: 'bk-1' }
    expect(settledRow(watch, [makeBackup()])).toBeNull()
    expect(settledRow(watch, [makeBackup({ id: 'bk-2', status: 'running' }), makeBackup()])).toBeNull()
    expect(settledRow(watch, [makeBackup({ id: 'bk-2', status: 'failed' }), makeBackup()])?.id).toBe('bk-2')
    expect(settledRow({ kind: 'backup', previousNewestId: null }, [makeBackup()])?.id).toBe('bk-1')
    // With the id from the 202 answer, only that row counts.
    const byId = { kind: 'backup' as const, previousNewestId: 'bk-1', backupId: 'bk-2' }
    expect(settledRow(byId, [makeBackup({ id: 'bk-3' }), makeBackup({ id: 'bk-2', status: 'running' })])).toBeNull()
    expect(settledRow(byId, [makeBackup({ id: 'bk-3' }), makeBackup({ id: 'bk-2' })])?.id).toBe('bk-2')
  })

  it('waits for a changed verification time', () => {
    const watch = { kind: 'verify' as const, backupId: 'bk-1', previousVerifiedAt: '2026-11-20T00:00:00Z' }
    expect(settledRow(watch, [makeBackup({ verified_at: '2026-11-20T00:00:00Z' })])).toBeNull()
    expect(settledRow(watch, [makeBackup({ verified_at: '2026-11-24T00:00:00Z', verify_status: 'passed' })])?.verify_status).toBe('passed')
  })
})
