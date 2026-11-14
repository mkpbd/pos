import { ApiError } from '@/lib/api/client'
import { cloneSample, IMAGE_MEDIA_ID } from '@/storefront/builder/test-payload'
import type { BuilderContent, Section } from '@/storefront/builder/types'
import { dropTargetOf, pictureFileProblem, setNodePicture, uploadErrorMessage, uploadPicture } from './media-upload'
import { findNode } from './tree'

class FakeXhr {
  static last: FakeXhr | null = null
  method = ''
  url = ''
  headers: Record<string, string> = {}
  withCredentials = false
  status = 0
  responseText = ''
  body: unknown = null
  upload: { onprogress: ((e: { lengthComputable: boolean; loaded: number; total: number }) => void) | null } = { onprogress: null }
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  onabort: (() => void) | null = null
  constructor() {
    FakeXhr.last = this
  }
  open(method: string, url: string) {
    this.method = method
    this.url = url
  }
  setRequestHeader(name: string, value: string) {
    this.headers[name] = value
  }
  send(body: unknown) {
    this.body = body
  }
  abort() {
    this.onabort?.()
  }
  respond(status: number, json: unknown) {
    this.status = status
    this.responseText = JSON.stringify(json)
    this.onload?.()
  }
}

const file = (name: string, type: string, size = 1000) => new File([new Uint8Array(size)], name, { type })

describe('picture drop (B10)', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('accepts JPEG, PNG, WebP and GIF up to 5 MB', () => {
    expect(pictureFileProblem(file('a.jpg', 'image/jpeg'))).toBeNull()
    expect(pictureFileProblem(file('a.pdf', 'application/pdf'))).toMatch(/isn’t a picture we can use/)
    expect(pictureFileProblem({ name: 'big.png', type: 'image/png', size: 6 * 1024 * 1024 })).toMatch(/larger than 5 MB/)
  })

  it('uploads with progress and the API client’s headers', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeXhr)
    document.cookie = 'XSRF-TOKEN=tok'
    const progress: number[] = []
    const promise = uploadPicture(file('a.png', 'image/png'), { onProgress: (p) => progress.push(p) })
    const xhr = FakeXhr.last!
    expect(xhr.method).toBe('POST')
    expect(xhr.url).toBe('/api/v1/media')
    expect(xhr.withCredentials).toBe(true)
    expect(xhr.headers['X-XSRF-TOKEN']).toBe('tok')
    expect((xhr.body as FormData).get('file')).toBeInstanceOf(File)
    xhr.upload.onprogress?.({ lengthComputable: true, loaded: 50, total: 100 })
    xhr.upload.onprogress?.({ lengthComputable: true, loaded: 100, total: 100 })
    xhr.respond(201, { success: true, data: { id: 'm-1', url: '/m.png', srcset: '', width: 10, height: 10, alt: null }, meta: {} })
    await expect(promise).resolves.toMatchObject({ id: 'm-1' })
    expect(progress).toEqual([0.5, 1])
  })

  it('turns failures into plain messages', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeXhr)
    const promise = uploadPicture(file('a.png', 'image/png'))
    FakeXhr.last!.respond(422, { success: false, error: { code: 'VALIDATION_FAILED', message: 'Invalid.', details: { file: ['The file is too big.'] } }, meta: {} })
    const error = await promise.catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect(uploadErrorMessage(error, 'a.png')).toBe('“a.png”: The file is too big.')
    expect(uploadErrorMessage(new ApiError(403, 'FORBIDDEN', 'No.'), 'a.png')).toMatch(/permission/)
    expect(uploadErrorMessage(new Error('x'), 'a.png')).toMatch(/couldn’t be uploaded/)

    const offline = uploadPicture(file('b.png', 'image/png'))
    FakeXhr.last!.onerror?.()
    expect(uploadErrorMessage(await offline.catch((e: unknown) => e), 'b.png')).toMatch(/can’t be reached/)
  })

  it('sets an image’s media id, or the background picture where it is set for the device', () => {
    const content = cloneSample()
    expect(dropTargetOf(findNode(content, 'e_image')!.node)).toBe('image')
    expect(dropTargetOf(findNode(content, 'e_heading')!.node)).toBeNull()
    expect(dropTargetOf(findNode(content, 's_story')!.node)).toBeNull()

    const image = setNodePicture(content, 'e_image', 'm-new')
    expect(((findNode(image, 'e_image')!.node as { props: { media_id: string } }).props).media_id).toBe('m-new')
    expect(setNodePicture(content, 'e_image', IMAGE_MEDIA_ID)).toBe(content)

    // A section with a background picture on desktop and its own on phones.
    const withBg: BuilderContent = structuredClone(content)
    const section = withBg.sections[2] as Section
    const bg = (media_id: string) => ({ type: 'image' as const, image: { media_id, position: 'center' as const, size: 'cover' as const, repeat: false } })
    section.style = { base: { background: bg('m-desk') }, mobile: { background: bg('m-phone') } }
    expect(dropTargetOf(section, 'tablet')).toBe('background')
    const tablet = setNodePicture(withBg, 's_features', 'm-2', 'tablet')
    const tabletStyle = (findNode(tablet, 's_features')!.node as Section).style
    expect(tabletStyle.base?.background?.image?.media_id).toBe('m-2')
    expect(tabletStyle.mobile?.background?.image?.media_id).toBe('m-phone')
    const phone = setNodePicture(withBg, 's_features', 'm-3', 'mobile')
    expect((findNode(phone, 's_features')!.node as Section).style.mobile?.background?.image?.media_id).toBe('m-3')
    expect(setNodePicture(content, 'e_heading', 'm-4')).toBe(content)
  })
})
