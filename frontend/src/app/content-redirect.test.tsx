import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ContentRedirect } from '@/app/content-redirect'

let granted: string[] = []
vi.mock('@/features/auth/use-auth', () => ({ useCan: () => (permission: string) => granted.includes(permission) }))

function landing() {
  render(
    <MemoryRouter initialEntries={['/content']}>
      <Routes>
        <Route path="/content" element={<ContentRedirect />} />
        <Route path="/content/pages" element={<p>pages</p>} />
        <Route path="/content/forms" element={<p>forms</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('ContentRedirect', () => {
  beforeEach(() => {
    granted = []
  })

  it('opens the content pages for people who manage content', () => {
    granted = ['cms.manage', 'forms.view']
    landing()
    expect(screen.getByText('pages')).toBeInTheDocument()
  })

  it('opens the form submissions for people who may only read those', () => {
    granted = ['forms.view']
    landing()
    expect(screen.getByText('forms')).toBeInTheDocument()
  })
})
