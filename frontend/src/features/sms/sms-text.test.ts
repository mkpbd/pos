import { describe, expect, it } from 'vitest'
import { analyzeSms, describeSms, insertAt, renderSmsTemplate } from '@/features/sms/sms-text'

const PLACEHOLDERS = ['shop', 'name', 'order', 'total', 'link', 'courier', 'tracking', 'tracking_link']

describe('analyzeSms (port of SmsText::analyze)', () => {
  it('counts plain GSM text: 160 characters fit one SMS, 161 need two parts of 153', () => {
    expect(analyzeSms('a'.repeat(160))).toEqual({ encoding: 'gsm', length: 160, segments: 1 })
    expect(analyzeSms('a'.repeat(161))).toEqual({ encoding: 'gsm', length: 161, segments: 2 })
    expect(analyzeSms('a'.repeat(306))).toEqual({ encoding: 'gsm', length: 306, segments: 2 })
    expect(analyzeSms('a'.repeat(307))).toEqual({ encoding: 'gsm', length: 307, segments: 3 })
  })

  it('counts extension characters twice', () => {
    expect(analyzeSms('{}')).toEqual({ encoding: 'gsm', length: 4, segments: 1 })
    expect(analyzeSms('€^~|[]\\')).toEqual({ encoding: 'gsm', length: 14, segments: 1 })
    expect(analyzeSms('a'.repeat(158) + '€')).toEqual({ encoding: 'gsm', length: 160, segments: 1 })
    expect(analyzeSms('a'.repeat(159) + '€')).toEqual({ encoding: 'gsm', length: 161, segments: 2 })
  })

  it('keeps accented GSM letters, new lines and symbols of the basic table in GSM', () => {
    expect(analyzeSms('Café Ñoño £5 @home\n¿§?')).toMatchObject({ encoding: 'gsm', length: 22 })
    // ú (acute) is not in the GSM table — only ù (grave) is.
    expect(analyzeSms('Ñandú')).toMatchObject({ encoding: 'unicode' })
  })

  it('switches the whole text to Unicode for Bangla: 70 in one SMS, parts of 67', () => {
    expect(analyzeSms('ক'.repeat(70))).toEqual({ encoding: 'unicode', length: 70, segments: 1 })
    expect(analyzeSms('ক'.repeat(71))).toEqual({ encoding: 'unicode', length: 71, segments: 2 })
    expect(analyzeSms('ক'.repeat(134))).toEqual({ encoding: 'unicode', length: 134, segments: 2 })
    expect(analyzeSms('ক'.repeat(135))).toEqual({ encoding: 'unicode', length: 135, segments: 3 })
    // One non-GSM character in English text makes it Unicode; extension characters then count once.
    expect(analyzeSms('Order {order} received ৳')).toEqual({ encoding: 'unicode', length: 24, segments: 1 })
    expect(analyzeSms('It’s here')).toMatchObject({ encoding: 'unicode' })
  })

  it('counts an emoji as two units and an empty text as no SMS', () => {
    expect(analyzeSms('😀')).toEqual({ encoding: 'unicode', length: 2, segments: 1 })
    expect(analyzeSms('')).toEqual({ encoding: 'gsm', length: 0, segments: 0 })
  })

  it('describes the count for the counter', () => {
    expect(describeSms(analyzeSms('a'.repeat(161)))).toBe('161 characters · 2 SMS · GSM')
    expect(describeSms(analyzeSms('ক'))).toBe('1 character · 1 SMS · Unicode')
  })
})

describe('renderSmsTemplate (port of SmsTemplate::render)', () => {
  it('fills known placeholders, keeps unknown ones and collapses double spaces', () => {
    expect(renderSmsTemplate('{shop}: Order {order} received. {foo} Total Tk {total}.', { shop: 'Corner', order: 'W-1', total: '10.00' }, PLACEHOLDERS)).toBe(
      'Corner: Order W-1 received. {foo} Total Tk 10.00.',
    )
    expect(renderSmsTemplate('Handed to {courier}, tracking {tracking} {tracking_link}', { courier: 'Pathao' }, PLACEHOLDERS)).toBe('Handed to Pathao, tracking')
  })
})

describe('insertAt', () => {
  it('inserts at the caret or replaces the selection', () => {
    expect(insertAt('Hello world', '{name} ', 6, 6)).toEqual({ value: 'Hello {name} world', caret: 13 })
    expect(insertAt('Hello world', '{shop}', 6, 11)).toEqual({ value: 'Hello {shop}', caret: 12 })
    expect(insertAt('Hi', '{order}', null, null)).toEqual({ value: 'Hi{order}', caret: 9 })
  })
})
