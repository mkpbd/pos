import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { bootstrapFixture } from '../../test-fixtures'
import { documentOf, elementNode, IMAGE_MEDIA_ID, payloadOf } from '../test-payload'
import { CanvasApp } from './canvas-app'
import { envelope, readCanvasMessage, readParentMessage, type ParentMessage } from './protocol'
import { createCanvasQueryClient } from './query-client'
import { sanitizeRichText } from './sanitize'
import { isEditLink, normalizePlain, readPlain } from './text-edit'
import { fieldTargets, imageTargetOf, indexNodes, textFields } from './text-fields'

const ORIGIN = window.location.origin

const message = (data: unknown) => new MessageEvent('message', { data, origin: ORIGIN, source: window })

describe('B10 text fields from the registry', () => {
  it('expands translatable patterns over the shown props, skipping texts that are not drawn', () => {
    expect(textFields({ type: 'heading', props: { text: 'Fresh bread', level: 2 } })).toEqual([{ field: 'text', value: 'Fresh bread', html: false }])
    expect(textFields({ type: 'text', props: { html: '<p>Hi</p>' } })).toEqual([{ field: 'html', value: '<p>Hi</p>', html: true }])
    expect(textFields({ type: 'image', props: { alt: 'A loaf' } })).toEqual([])
    const accordion = textFields({ type: 'accordion', props: { items: [{ id: 'item-1', title: 'Q', html: '<p>A</p>' }, { id: 'bad id!', title: 'X' }] } })
    expect(accordion).toEqual([
      { field: 'items.item-1.title', value: 'Q', html: false },
      { field: 'items.item-1.html', value: '<p>A</p>', html: true },
    ])
    expect(textFields({ type: 'cta', props: { title: 'Sale', text: '', primary: { label: 'Shop' } } }).map((f) => f.field)).toEqual(['title', 'primary.label'])
    // Wrapped homepage sections are edited in the inspector only.
    expect(textFields({ type: 'hero_slider', props: { title: 'x' } })).toEqual([])
  })

  it('finds where each text is drawn: the innermost element with the text, rich text by its markup', () => {
    const root = document.createElement('div')
    root.dataset.b = 'e_cta'
    root.innerHTML = '<h2><a href="/x">Sale</a></h2><p class="whitespace-pre-line">Line one\nline two</p><a data-b="e_inner">Shop</a><span>Shop</span>'
    const targets = fieldTargets(root, { type: 'cta', props: { title: 'Sale', text: 'Line one\nline two', primary: { label: 'Shop' } } })
    expect(targets.map((t) => [t.field, t.element.tagName, t.kind])).toEqual([
      ['title', 'A', 'line'],
      ['text', 'P', 'multiline'],
      // A nested node's own markup is not this node's.
      ['primary.label', 'SPAN', 'line'],
    ])
    const text = document.createElement('div')
    text.dataset.b = 'e_text'
    text.className = 'sf-rich-text'
    text.innerHTML = '<p>Hi <strong>you</strong></p>'
    expect(fieldTargets(text, { type: 'text', props: { html: '<p>Hi <strong>you</strong></p>' } })[0]).toMatchObject({ field: 'html', kind: 'html', element: text })
  })

  it('knows which nodes take a dropped picture', () => {
    const page = payloadOf(documentOf([elementNode('image', 'e_img', { media_id: IMAGE_MEDIA_ID }), elementNode('heading', 'e_head')]), { source: 'draft' })
    const sections = page.sections.map((s) => ({ ...s, style: { base: { background: { type: 'image', image: { media_id: IMAGE_MEDIA_ID, position: 'center', size: 'cover', repeat: false } } } } }))
    const nodes = indexNodes(sections as typeof page.sections)
    expect(imageTargetOf(nodes.get('e_img'))).toBe('image')
    expect(imageTargetOf(nodes.get('s_row0'))).toBe('background')
    expect(imageTargetOf(nodes.get('e_head'))).toBeNull()
    expect(imageTargetOf(nodes.get('c_row0'))).toBeNull()
  })
})

describe('B10 rich text and plain text commits', () => {
  it('keeps only the server tags, mapping the browser editing markup onto them', () => {
    expect(sanitizeRichText('<div>One <b>bold</b> <i>it</i></div><div><span style="color:red">two</span></div>')).toBe('<p>One <strong>bold</strong> <em>it</em></p><p>two</p>')
    expect(sanitizeRichText('<p onclick="x()">a <a href="javascript:alert(1)" onclick="y()">x</a> <a href="/shop" target="_top" class="c">s</a></p><script>1</script>')).toBe('<p>a <a>x</a> <a href="/shop">s</a></p>')
    expect(sanitizeRichText('<h1>T</h1><ul><li>a</li></ul><font>f</font><!-- c -->')).toBe('<h2>T</h2><ul><li>a</li></ul>f')
    expect(sanitizeRichText('  ')).toBe('')
  })

  it('reads typed text without the theme case and with line breaks', () => {
    const el = document.createElement('p')
    el.innerHTML = 'One<br>two<div>three</div>'
    expect(readPlain(el)).toBe('One\ntwo\nthree')
    expect(normalizePlain(' a \n b ', 'line')).toBe('a b')
    expect(normalizePlain('a  \nb\r\n', 'multiline')).toBe('a\nb')
    expect(isEditLink('/shop')).toBe(true)
    expect(isEditLink('https://example.com')).toBe(true)
    expect(isEditLink('javascript:alert(1)')).toBe(false)
    expect(isEditLink('//evil.test')).toBe(false)
  })
})

describe('B10 protocol additions', () => {
  it('accepts the text, locale and link messages both ways', () => {
    for (const data of [
      { type: 'edit-text', id: 'e_x', field: 'text' },
      { type: 'set-locale', locale: 'bn' },
      { type: 'end-text-edit', commit: true },
      { type: 'text-edit-link-result', url: '/shop' },
    ] satisfies ParentMessage[]) {
      expect(readParentMessage(message(envelope(data)), ORIGIN, window)).toMatchObject(data)
    }
    for (const type of ['text-edit-start', 'text-edit-commit', 'text-edit-cancel', 'text-edit-link', 'image-drop', 'image-replace']) {
      expect(readCanvasMessage(message(envelope({ type, id: 'e_x' } as never)), ORIGIN, window)).not.toBeNull()
    }
  })
})

describe('B10 editing on the canvas', () => {
  const doc = documentOf([
    elementNode('heading', 'e_head', { text: 'Fresh bread' }),
    elementNode('text', 'e_text', { html: '<p>Hello <strong>world</strong></p>' }),
    elementNode('notice', 'e_note', { title: '', text: 'First line\nsecond line' }),
    elementNode('image', 'e_img', { media_id: IMAGE_MEDIA_ID, alt: 'Loaf' }),
  ])
  const page = payloadOf(doc, { source: 'draft' })
  const frame = (overrides: Partial<Extract<ParentMessage, { type: 'render' }>> = {}): ParentMessage => ({
    type: 'render',
    sections: page.sections,
    data: page.data,
    media: page.media,
    selection: null,
    hover: null,
    errors: [],
    device: 'desktop',
    pending: [],
    ...overrides,
  })

  async function mount() {
    const posted: { type: string; [key: string]: unknown }[] = []
    vi.spyOn(window, 'postMessage').mockImplementation((data: unknown) => {
      posted.push(data as { type: string })
    })
    render(
      <QueryClientProvider client={createCanvasQueryClient()}>
        <MemoryRouter>
          <CanvasApp parent={window} origin={ORIGIN} />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    const send = (data: ParentMessage) => act(() => void window.dispatchEvent(message(envelope(data))))
    send({ type: 'init', bootstrap: bootstrapFixture(), locale: 'en' })
    send(frame())
    await screen.findByRole('heading', { name: 'Fresh bread' })
    const sent = (type: string) => posted.filter((m) => m.type === type)
    return { posted, send, sent }
  }

  afterEach(() => vi.useRealTimers())

  it('double-click edits a heading in place; Enter commits one value and the next render draws it', async () => {
    const { send, sent } = await mount()
    const heading = screen.getByRole('heading', { name: 'Fresh bread' })
    fireEvent.dblClick(heading)
    expect(heading).toHaveAttribute('contenteditable')
    expect(heading).toHaveAttribute('data-b-editing', 'line')
    expect(sent('text-edit-start')).toEqual([expect.objectContaining({ id: 'e_head', field: 'text', locale: 'en', kind: 'line' })])

    // Keys typed into the text never reach the editor as shortcuts.
    fireEvent.keyDown(heading, { key: 'Delete' })
    expect(sent('key')).toEqual([])

    heading.textContent = 'Warm bread'
    fireEvent.keyDown(heading, { key: 'Enter' })
    expect(sent('text-edit-commit')).toEqual([expect.objectContaining({ id: 'e_head', field: 'text', value: 'Warm bread', locale: 'en', kind: 'line' })])
    // Until the editor's render the typed text stays; then React draws the committed value.
    expect(heading).not.toHaveAttribute('contenteditable')
    expect(heading).toHaveTextContent('Warm bread')
    const next = payloadOf(
      documentOf([
        elementNode('heading', 'e_head', { text: 'Warm bread' }),
        elementNode('text', 'e_text', { html: '<p>Hello <strong>world</strong></p>' }),
        elementNode('notice', 'e_note', { title: '', text: 'First line\nsecond line' }),
        elementNode('image', 'e_img', { media_id: IMAGE_MEDIA_ID, alt: 'Loaf' }),
      ]),
      { source: 'draft' },
    )
    send(frame({ sections: next.sections }))
    const updated = screen.getByRole('heading', { name: 'Warm bread' })
    expect(updated).not.toHaveAttribute('data-b-editing')
    expect(document.querySelectorAll('[data-b="e_head"]')).toHaveLength(1)
  })

  it('Escape cancels and puts the text back; an unchanged commit is a cancel', async () => {
    const { sent } = await mount()
    const heading = screen.getByRole('heading', { name: 'Fresh bread' })
    fireEvent.dblClick(heading)
    heading.textContent = 'Oops'
    fireEvent.keyDown(heading, { key: 'Escape' })
    expect(sent('text-edit-cancel')).toEqual([expect.objectContaining({ id: 'e_head', field: 'text' })])
    expect(heading).toHaveTextContent('Fresh bread')
    expect(heading).not.toHaveAttribute('contenteditable')

    fireEvent.dblClick(heading)
    fireEvent.keyDown(heading, { key: 'Tab' })
    expect(sent('text-edit-cancel')).toHaveLength(2)
    expect(sent('text-edit-commit')).toEqual([])
  })

  it('Enter on the selected node and the editor’s edit-text start an edit; a click outside commits', async () => {
    const { send, sent } = await mount()
    send(frame({ selection: 'e_note' }))
    fireEvent.keyDown(document.body, { key: 'Enter' })
    const note = sent('text-edit-start')[0]
    expect(note).toMatchObject({ id: 'e_note', field: 'text', kind: 'multiline' })
    const editable = document.querySelector<HTMLElement>('[data-b-editing]')!
    editable.textContent = 'Only line'
    fireEvent.pointerDown(document.body)
    expect(sent('text-edit-commit')).toEqual([expect.objectContaining({ id: 'e_note', value: 'Only line' })])

    send({ type: 'edit-text', id: 'e_head', field: 'text' })
    expect(sent('text-edit-start')[1]).toMatchObject({ id: 'e_head', field: 'text' })
    send({ type: 'end-text-edit', commit: false })
    expect(sent('text-edit-cancel')).toHaveLength(1)
  })

  it('rich text gets the format bar; Link asks the editor and its answer is applied', async () => {
    const { send, sent } = await mount()
    send({ type: 'edit-text', id: 'e_text' })
    const text = document.querySelector<HTMLElement>('[data-b="e_text"]')!
    expect(text).toHaveAttribute('contenteditable', 'true')
    const bar = await screen.findByRole('toolbar', { name: 'Text format' })
    for (const name of ['Bold', 'Italic', 'Link', 'Bulleted list', 'Numbered list', 'Clear formatting']) expect(screen.getByRole('button', { name })).toBeInTheDocument()
    expect(bar).toHaveAttribute('data-b-format-bar')
    fireEvent.click(screen.getByRole('button', { name: 'Link' }))
    expect(sent('text-edit-link')).toEqual([expect.objectContaining({ id: 'e_text', field: 'html', url: null })])
    // The editor's prompt took the focus: no commit on blur while it is open.
    act(() => void window.dispatchEvent(new Event('blur')))
    expect(sent('text-edit-commit')).toEqual([])
    send({ type: 'text-edit-link-result', url: null })

    text.innerHTML = '<div>Hi <b>there</b></div><script>x</script>'
    fireEvent.keyDown(text, { key: 'Tab' })
    expect(sent('text-edit-commit')).toEqual([expect.objectContaining({ id: 'e_text', field: 'html', value: '<p>Hi <strong>there</strong></p>', kind: 'html' })])
    expect(screen.queryByRole('toolbar', { name: 'Text format' })).not.toBeInTheDocument()
  })

  it('pictures: double-click asks for a replacement, a dropped file goes to the editor', async () => {
    const { sent } = await mount()
    const image = document.querySelector<HTMLElement>('[data-b="e_img"]')!
    fireEvent.dblClick(image.querySelector('img') ?? image)
    expect(sent('image-replace')).toEqual([expect.objectContaining({ id: 'e_img', target: 'image' })])

    const file = new File(['x'], 'photo.png', { type: 'image/png' })
    const dataTransfer = { types: ['Files'], files: [file], dropEffect: 'none' }
    fireEvent.dragOver(image, { dataTransfer })
    await waitFor(() => expect(screen.getByTestId('canvas-outlines').textContent).toContain('[data-b="e_img"]{outline:3px dashed'))
    expect(dataTransfer.dropEffect).toBe('copy')
    fireEvent.drop(image, { dataTransfer })
    expect(sent('image-drop')).toEqual([expect.objectContaining({ id: 'e_img', target: 'image', file })])
    // Not on an image: nothing to drop on.
    fireEvent.drop(screen.getByRole('heading', { name: 'Fresh bread' }), { dataTransfer })
    expect(sent('image-drop')).toHaveLength(1)
  })

  it('set-locale switches the canvas language', async () => {
    const { send } = await mount()
    send({ type: 'set-locale', locale: 'bn' })
    await waitFor(() => expect(document.documentElement.lang).toBe('bn'))
    send({ type: 'set-locale', locale: 'xx' })
    expect(document.documentElement.lang).toBe('bn')
    send({ type: 'set-locale', locale: 'en' })
    await waitFor(() => expect(document.documentElement.lang).toBe('en'))
  })
})
