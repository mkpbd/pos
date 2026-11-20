import { describe, expect, it } from 'vitest'
import { exportFilename, readPresence, readThreads, slugify } from './collab-api'
import {
  activityVersion,
  activityWords,
  anchorIn,
  avatarColor,
  AVATAR_COLORS,
  canStillEdit,
  hitNode,
  initials,
  insertMention,
  lockExpired,
  mentionedIds,
  mentionParts,
  mentionQuery,
  otherViewers,
  pinPoint,
  threadNumbers,
  timeRange,
} from './collab-model'

/* B16 pure helpers: presence and comment readers, pins, mentions, activity words. */

const rima = { id: 'u-2', name: 'Rima Akter' }

describe('presence', () => {
  it('reads a presence answer leniently', () => {
    const p = readPresence({
      viewers: [{ user: rima, editing: true, since: '2026-11-20T10:00:00Z', last_seen: '2026-11-20T10:01:00Z', is_me: false }, { user: { id: 7 } }, { nope: true }],
      lock: { user: rima, acquired_at: 'a', expires_at: 'b' },
      mine: false,
      draft_revision: 9,
      comments: { open: '3', updated_at: 'x' },
    })
    expect(p.viewers).toHaveLength(2)
    expect(p.viewers[1]).toMatchObject({ user: { id: '7', name: 'Someone' }, editing: false, is_me: false })
    expect(p.lock?.user.name).toBe('Rima Akter')
    expect(p.draft_revision).toBe(9)
    expect(p.comments).toEqual({ open: 3, updated_at: 'x' })
    expect(readPresence([])).toEqual({ viewers: [], lock: null, mine: false, draft_revision: null, comments: null })
  })

  it('lists the other people once each, the editor first', () => {
    const viewers = [
      { user: { id: 'u-1', name: 'Me' }, editing: false, since: null, last_seen: null, is_me: true },
      { user: { id: 'u-3', name: 'Zahid' }, editing: false, since: null, last_seen: null, is_me: false },
      { user: rima, editing: false, since: null, last_seen: null, is_me: false },
      { user: rima, editing: true, since: null, last_seen: null, is_me: false },
    ]
    expect(otherViewers(viewers, 'u-1').map((v) => [v.user.name, v.editing])).toEqual([
      ['Rima Akter', true],
      ['Zahid', false],
    ])
  })

  it('initials, stable colours and an expired lease', () => {
    expect(initials('Rima Akter')).toBe('RA')
    expect(initials('  nadia ')).toBe('N')
    expect(initials('')).toBe('?')
    expect(avatarColor('u-2')).toBe(avatarColor('u-2'))
    expect(AVATAR_COLORS).toContain(avatarColor('anything'))
    expect(lockExpired({ user: rima, acquired_at: null, expires_at: '2026-11-20T10:00:00Z' }, Date.parse('2026-11-20T10:00:01Z'))).toBe(true)
    expect(lockExpired({ user: rima, acquired_at: null, expires_at: '2026-11-20T10:00:00Z' }, Date.parse('2026-11-20T09:59:00Z'))).toBe(false)
    expect(lockExpired(null)).toBe(false)
  })
})

describe('comments', () => {
  it('folds a flat list into threads and keeps the server numbers', () => {
    const threads = readThreads([
      { id: 'c1', number: 4, body: 'Bigger?', node_id: 'e_title', anchor: { x: 2, y: -1 }, author: rima, created_at: '2026-11-20T10:00:00Z', replies: [] },
      { id: 'r1', parent_id: 'c1', body: 'Yes', author: rima },
      { id: 'c2', body: 'Whole page', created_at: '2026-11-20T09:00:00Z' },
    ])
    expect(threads.map((t) => t.id)).toEqual(['c1', 'c2'])
    expect(threads[0]!.anchor).toEqual({ x: 1, y: 0 })
    expect(threads[0]!.replies.map((r) => r.id)).toEqual(['r1'])
    const numbers = threadNumbers(threads)
    expect(numbers.get('c1')).toBe(4)
    expect(numbers.get('c2')).toBe(1)
  })

  it('finds the smallest part under the click and the anchor inside it', () => {
    const rects = { s1: { x: 0, y: 0, w: 1000, h: 600 }, e1: { x: 100, y: 100, w: 200, h: 50 }, hidden: { x: 0, y: 0, w: 0, h: 0 } }
    expect(hitNode(rects, { x: 150, y: 120 })).toBe('e1')
    expect(hitNode(rects, { x: 150, y: 120 }, (id) => id !== 'e1')).toBe('s1')
    expect(hitNode(rects, { x: 2000, y: 2000 })).toBeNull()
    expect(anchorIn(rects.e1, { x: 150, y: 125 })).toEqual({ x: 0.25, y: 0.5 })
    expect(pinPoint(rects.e1, { x: 0.5, y: 1 })).toEqual({ x: 200, y: 150 })
  })

  it('may be changed by its author for 15 minutes', () => {
    const comment = readThreads([{ id: 'c', can_edit: true, created_at: '2026-11-20T10:00:00Z' }])[0]!
    expect(canStillEdit(comment, Date.parse('2026-11-20T10:14:00Z'))).toBe(true)
    expect(canStillEdit(comment, Date.parse('2026-11-20T10:16:00Z'))).toBe(false)
    expect(canStillEdit({ ...comment, can_edit: false }, Date.parse('2026-11-20T10:01:00Z'))).toBe(false)
  })
})

describe('mentions', () => {
  it('finds the @name being typed and puts the picked name in', () => {
    expect(mentionQuery('Hi @ri', 6)).toEqual({ start: 3, query: 'ri' })
    expect(mentionQuery('email@ri', 8)).toBeNull()
    expect(mentionQuery('@', 1)).toEqual({ start: 0, query: '' })
    const result = insertMention('Hi @ri please', { start: 3, query: 'ri' }, 'Rima Akter')
    expect(result.text).toBe('Hi @Rima Akter please')
    expect(result.caret).toBe('Hi @Rima Akter '.length)
    expect(mentionedIds('Hi @Rima Akter', [rima, { id: 'u-9', name: 'Gone' }])).toEqual(['u-2'])
  })

  it('splits a comment into text and mentions', () => {
    expect(mentionParts('Ask @Rima Akter now', [rima])).toEqual([
      { text: 'Ask ', mention: false },
      { text: '@Rima Akter', mention: true },
      { text: ' now', mention: false },
    ])
    expect(mentionParts('plain', [])).toEqual([{ text: 'plain', mention: false }])
  })
})

describe('activity and export', () => {
  it('words editing sessions and server summaries plainly', () => {
    const edited = { id: '1', at: '2026-11-20T09:40:00Z', user: rima, action: 'edited', summary: '', details: { saves: 12, started_at: '2026-11-20T09:10:00Z', ended_at: '2026-11-20T09:40:00Z' } }
    expect(activityWords(edited, 'Asia/Dhaka')).toBe('edited the draft (12 saves, 3:10–3:40 PM)')
    expect(timeRange('2026-11-20T05:50:00Z', '2026-11-20T06:10:00Z', 'Asia/Dhaka')).toBe('11:50 AM–12:10 PM')
    const published = { id: '2', at: 'x', user: rima, action: 'storefront.builder_published', summary: 'Rima Akter published version 4', details: { version_id: 'v4', version_number: 4 } }
    expect(activityWords(published)).toBe('published version 4')
    expect(activityVersion(published)).toEqual({ id: 'v4', number: 4 })
    expect(activityWords({ ...published, summary: 'Published version 4' })).toBe('published version 4')
    expect(activityWords({ ...published, summary: '', action: 'lock_taken_over', details: {} })).toBe('took over editing')
    expect(activityVersion({ ...published, details: {} })).toBeNull()
  })

  it('names the download after the page and makes slugs', () => {
    expect(exportFilename('Eid sale 2026!')).toBe('eid-sale-2026.json')
    expect(exportFilename('ঈদ অফার')).toBe('ঈদ-অফার.json')
    expect(exportFilename('***')).toBe('page.json')
    expect(slugify('  Eid Sale — Café ')).toBe('eid-sale-cafe')
  })
})
