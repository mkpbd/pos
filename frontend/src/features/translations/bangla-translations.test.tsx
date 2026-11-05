import { useEffect, useState } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useForm } from 'react-hook-form'
import { describe, expect, it, vi } from 'vitest'
import { BanglaInput, BanglaTranslations } from '@/features/translations/components/bangla-translations'
import {
  bnErrors,
  countTranslated,
  handleTranslatedFormError,
  plainText,
  readBn,
  rhfBnErrors,
  toTranslationsInput,
  translationsSchema,
  validateBn,
  type BnValues,
  type TranslationField,
} from '@/features/translations/translations'
import { ApiError } from '@/lib/api/client'
import { createTestQueryClient, renderWithQuery } from '@/test/utils'

const toastError = vi.hoisted(() => vi.fn())
vi.mock('sonner', async (importOriginal) => {
  const original = await importOriginal<typeof import('sonner')>()
  return { ...original, toast: Object.assign(vi.fn(), { ...original.toast, error: toastError, success: vi.fn() }) }
})

const FIELDS: TranslationField[] = [
  { name: 'title', label: 'Title', base: 'About us', max: 20 },
  { name: 'excerpt', label: 'Excerpt', base: '', kind: 'textarea', max: 50 },
  { name: 'body_html', label: 'Page text', base: '<p>Hello <strong>there</strong> &amp; welcome</p>', kind: 'rich' },
]

function Harness({ initial = {}, errors, onValue }: { initial?: BnValues; errors?: Record<string, string>; onValue?: (v: BnValues) => void }) {
  const [value, setValue] = useState<BnValues>({ title: '', excerpt: '', body_html: '', ...initial })
  return (
    <BanglaTranslations
      fields={FIELDS}
      value={value}
      onChange={(next) => {
        setValue(next)
        onValue?.(next)
      }}
      errors={errors}
    />
  )
}

const toggle = () => screen.getByRole('button', { name: /বাংলা \(Bangla\)/ })

describe('BanglaTranslations', () => {
  it('starts collapsed when nothing is translated and opens with Bangla inputs per field', async () => {
    const user = userEvent.setup()
    const seen: BnValues[] = []
    renderWithQuery(<Harness onValue={(v) => seen.push(v)} />)

    expect(screen.getByRole('heading', { name: /বাংলা \(Bangla\)/ })).toBeInTheDocument()
    expect(toggle()).toHaveAttribute('aria-expanded', 'false')
    expect(toggle()).toHaveTextContent('Not translated')
    expect(screen.queryByLabelText('Title in Bangla')).not.toBeInTheDocument()

    await user.click(toggle())
    expect(toggle()).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText(/Leave a field empty to show the English text\./)).toBeInTheDocument()

    const title = screen.getByLabelText('Title in Bangla')
    expect(title).toHaveAttribute('lang', 'bn')
    expect(title).toHaveAttribute('placeholder', 'About us')
    expect(title).toHaveAttribute('maxLength', '20')
    expect(screen.getByText('0/20')).toBeInTheDocument()

    const excerpt = screen.getByLabelText('Excerpt in Bangla')
    expect(excerpt.tagName).toBe('TEXTAREA')
    // No English text: the hint says so instead of an empty placeholder.
    expect(screen.getByText('0/50 · No English text yet.')).toBeInTheDocument()

    // Rich text uses the shared editor, marked as Bangla, with the English text as a hint.
    const body = await screen.findByRole('textbox', { name: 'Page text in Bangla' })
    expect(body).toHaveAttribute('lang', 'bn')
    expect(screen.getByText('Hello there & welcome')).toBeInTheDocument()

    await user.type(title, 'আমাদের কথা')
    expect(screen.getByText('10/20')).toBeInTheDocument()
    expect(seen.at(-1)).toEqual({ title: 'আমাদের কথা', excerpt: '', body_html: '' })
    expect(toggle()).toHaveTextContent('1 of 3 translated')
  })

  it('starts open when something is translated already', () => {
    renderWithQuery(<Harness initial={{ title: 'আমাদের কথা', excerpt: 'সংক্ষেপ', body_html: '<p>নমস্কার</p>' }} />)
    expect(toggle()).toHaveAttribute('aria-expanded', 'true')
    expect(toggle()).toHaveTextContent('Translated')
    expect(screen.getByLabelText('Title in Bangla')).toHaveValue('আমাদের কথা')
  })

  it('opens by itself to show an error on the right Bangla input', () => {
    const { rerender } = renderWithQuery(<Harness />)
    expect(toggle()).toHaveAttribute('aria-expanded', 'false')

    rerender(<QueryClientProvider client={createTestQueryClient()}><Harness errors={{ title: 'The Bangla title is too long.' }} /></QueryClientProvider>)
    expect(toggle()).toHaveAttribute('aria-expanded', 'true')
    const title = screen.getByLabelText('Title in Bangla')
    expect(title).toHaveAttribute('aria-invalid', 'true')
    expect(title).toHaveAccessibleDescription('The Bangla title is too long.')
  })

  it('offers a compact Bangla input for one field', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<BanglaInput label="Item 1 Bangla label" base="Boys" value="" onChange={onChange} max={80} error="Too long." />)
    const input = screen.getByRole('textbox', { name: 'Item 1 Bangla label' })
    expect(input).toHaveAttribute('lang', 'bn')
    expect(input).toHaveAttribute('placeholder', 'বাংলা: Boys')
    expect(input).toHaveAccessibleDescription('Too long.')
    await user.type(input, 'ক')
    expect(onChange).toHaveBeenCalledWith('ক')
  })
})

describe('translation helpers', () => {
  it('reads, counts and writes Bangla values', () => {
    const bn = readBn({ bn: { title: 'শিরোনাম', excerpt: null, other: 'x' } }, ['title', 'excerpt'])
    expect(bn).toEqual({ title: 'শিরোনাম', excerpt: '' })
    expect(readBn(null, ['title'])).toEqual({ title: '' })
    expect(countTranslated({ title: ' ', excerpt: 'ক' }, ['title', 'excerpt'])).toBe(1)
    // Every field is sent; "" removes the translation on the server.
    expect(toTranslationsInput({ title: '  শিরোনাম ', excerpt: '   ' }, ['title', 'excerpt'])).toEqual({ bn: { title: 'শিরোনাম', excerpt: '' } })
    // Nothing translated now or before: left out, so untouched records save as before.
    expect(toTranslationsInput({ title: ' ', excerpt: '' }, ['title', 'excerpt'])).toBeUndefined()
    expect(toTranslationsInput({ title: '', excerpt: '' }, ['title', 'excerpt'], { bn: { title: null } })).toBeUndefined()
    // Clearing a saved translation still sends "" so the server removes it.
    expect(toTranslationsInput({ title: '', excerpt: '' }, ['title', 'excerpt'], { bn: { title: 'শিরোনাম' } })).toEqual({ bn: { title: '', excerpt: '' } })
  })

  it('validates the same limits as the base fields and picks Bangla errors by key', () => {
    expect(validateBn({ title: 'ক'.repeat(21), excerpt: '' }, FIELDS)).toEqual({ 'translations.bn.title': 'At most 20 characters.' })
    expect(bnErrors({ title: 'x', 'translations.bn.title': 'Too long.', 'translations.bn.excerpt': '' })).toEqual({ title: 'Too long.' })
    expect(bnErrors({ 'items.0.translations.bn.label': 'Bad.' }, 'items.0.translations.bn.')).toEqual({ label: 'Bad.' })
    expect(rhfBnErrors({ bn: { title: { message: 'Too long.' }, excerpt: undefined } })).toEqual({ title: 'Too long.' })
    expect(rhfBnErrors(undefined)).toEqual({})

    const schema = translationsSchema(FIELDS)
    expect(schema.safeParse({ bn: { title: 'ক', excerpt: '', body_html: '<p>x</p>' } }).success).toBe(true)
    expect(schema.safeParse({ bn: { title: 'ক'.repeat(21), excerpt: '', body_html: '' } }).success).toBe(false)
  })

  it('strips HTML for the English hint of rich text', () => {
    expect(plainText('<p>A&nbsp;<em>b</em></p><p>c</p>')).toBe('A b c')
    expect(plainText(`<p>${'x'.repeat(200)}</p>`, 10)).toBe('xxxxxxxxx…')
    expect(plainText(null)).toBe('')
  })

  it('puts server errors on nested Bangla inputs and the rest on their fields', () => {
    const captured: { setError?: ReturnType<typeof useForm>['setError'] } = {}
    function Form({ onReady }: { onReady: (setError: ReturnType<typeof useForm>['setError']) => void }) {
      const form = useForm<{ name: string; translations: { bn: { name: string } } }>({ defaultValues: { name: '', translations: { bn: { name: '' } } } })
      useEffect(() => onReady(form.setError as never), [form, onReady])
      return <p data-testid="errors">{JSON.stringify({ name: form.formState.errors.name?.message, bn: form.formState.errors.translations?.bn?.name?.message })}</p>
    }
    render(<Form onReady={(fn) => (captured.setError = fn)} />)
    const setError = vi.fn(captured.setError!)

    handleTranslatedFormError(new ApiError(422, 'VALIDATION_FAILED', 'Invalid', { 'translations.bn.name': ['Too long.'] }), setError, ['name', 'translations'] as never)
    expect(setError).toHaveBeenCalledWith('translations.bn.name', { type: 'server', message: 'Too long.' }, { shouldFocus: false })
    expect(toastError).toHaveBeenCalledWith('Please correct the highlighted Bangla fields.')

    setError.mockClear()
    toastError.mockClear()
    handleTranslatedFormError(new ApiError(422, 'VALIDATION_FAILED', 'Invalid', { name: ['Required.'], 'translations.bn.name': ['Too long.'] }), setError, ['name', 'translations'] as never)
    expect(setError).toHaveBeenCalledWith('name', { type: 'server', message: 'Required.' })
    expect(setError).toHaveBeenCalledWith('translations.bn.name', { type: 'server', message: 'Too long.' }, { shouldFocus: false })
    expect(toastError).not.toHaveBeenCalled()

    handleTranslatedFormError(new ApiError(500, 'SERVER_ERROR', 'Boom'), setError, ['name'] as never)
    expect(toastError).toHaveBeenCalledWith('Boom')
    expect(within(screen.getByTestId('errors')).queryByText('Boom')).not.toBeInTheDocument()
  })
})
