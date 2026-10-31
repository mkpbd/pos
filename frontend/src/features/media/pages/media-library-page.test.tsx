import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { routes } from '@/app/routes'
import { formatBytes, rejectReason, type MediaItem } from '@/features/media/api'
import { makeCurrentUser } from '@/test/fixtures'
import { mockApi, ok, renderRoutes } from '@/test/utils'

const item: MediaItem = {
  id: 'm-1', url: '/storage/media/o-1/m-1.png', srcset: '/storage/media/o-1/m-1-320.webp 320w, /storage/media/o-1/m-1.png 1600w',
  width: 1600, height: 900, alt: null, original_name: 'hero.png', mime_type: 'image/png', size: 345_000, created_at: null,
}

describe('media library', () => {
  it('lists images and edits alt text', async () => {
    const user = userEvent.setup()
    let patched: unknown
    mockApi({
      'GET /auth/me': ok(makeCurrentUser({ permissions: ['media.manage'] })),
      'GET /media': ok([item], { pagination: { current_page: 1, per_page: 24, total: 1, last_page: 1 } }),
      'PATCH /media/m-1': (init) => {
        patched = JSON.parse(String(init.body))
        return ok({ ...item, alt: 'Spring sale' })
      },
    })
    renderRoutes(routes, '/media')

    expect(await screen.findByText('hero.png')).toBeInTheDocument()
    expect(screen.getByText('1600×900 · 337 KB')).toBeInTheDocument()
    expect(screen.getByText('No alt text')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Edit alt text of hero.png' }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText('Alt text'), 'Spring sale')
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(patched).toEqual({ alt: 'Spring sale' }))
  })

  it('pre-checks file type and size before uploading', () => {
    expect(rejectReason(new File(['x'], 'a.svg', { type: 'image/svg+xml' }))).toMatch(/only JPEG/)
    expect(rejectReason(new File([new Uint8Array(6 * 1024 * 1024)], 'big.png', { type: 'image/png' }))).toMatch(/5 MB/)
    expect(rejectReason(new File(['x'], 'ok.webp', { type: 'image/webp' }))).toBeNull()
    expect(formatBytes(2_621_440)).toBe('2.5 MB')
  })
})
