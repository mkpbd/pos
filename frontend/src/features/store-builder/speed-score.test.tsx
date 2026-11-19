import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { BuilderContent } from '@/storefront/builder/types'
import { CheckPanel } from './check-panel'
import { checkCounts, runPageCheck, type PageCheckIssue } from './page-check'
import type { PageCheck } from './use-page-check'

const VIS = { desktop: true, tablet: true, mobile: true }
const node = (id: string, type: string, props: Record<string, unknown>) => ({ id, type, props, style: {}, visibility: VIS, hidden: false, schedule: null, translations: {} })

function pageCheck(issues: PageCheckIssue[]): PageCheck {
  return { issues, counts: checkCounts(issues), server: { status: 'done', issues: [] }, runServer: vi.fn(async () => {}) }
}

function heavyPage(): PageCheckIssue[] {
  const content = {
    schema_version: 1,
    seo: { title: 'T', description: 'D', image: null, noindex: false, translations: {} },
    sections: [
      {
        ...node('s1', 'section', { layout: 'boxed', anchor: null }),
        columns: [{ id: 'c1', type: 'column', width: { base: 100 }, style: {}, elements: [node('h', 'heading', { text: 'Hi', level: 1, link: null }), node('img', 'image', { media_id: 'm', alt: 'A', link: null, aspect: 'auto', fit: 'cover' })] }],
      },
    ],
  } as unknown as BuilderContent
  return runPageCheck({
    content,
    document: { kind: 'page', key: 'home' },
    theme: { colors: {}, container_width: 1200, fonts: { heading: 'playfair', body: 'jost', bangla_heading: 'anek-bangla', bangla_body: 'tiro-bangla' } },
    media: { m: { url: '/o/m.jpg', srcset: '/o/m.jpg 2400w', width: 2400, height: 1600, size: 3 * 1024 * 1024 } },
  })
}

describe('Speed in the Check page panel', () => {
  it('shows the score, its rating in words and the Speed issues (most points first) with Fix it', async () => {
    const onFix = vi.fn()
    render(<CheckPanel check={pageCheck(heavyPage())} labelOf={(id) => (id === 'img' ? 'Image' : null)} onShow={vi.fn()} onFix={onFix} onClose={vi.fn()} />)
    const speed = screen.getByTestId('check-speed')
    expect(within(speed).getByRole('heading', { name: 'Speed' })).toBeInTheDocument()
    const meter = within(speed).getByRole('meter', { name: 'Speed score' })
    // The two Latin font files (no Bangla text, so no Bangla fonts) add to the page weight: 13 points for it, not 12.
    expect(meter).toHaveAttribute('aria-valuenow', '65')
    expect(meter).toHaveAttribute('aria-valuetext', '65 of 100, Could be faster')
    expect(within(speed).getByTestId('speed-rating')).toHaveTextContent('Could be faster')
    const list = within(speed).getByRole('list', { name: 'Speed' })
    const rows = within(list).getAllByRole('listitem')
    expect(rows.map((row) => row.dataset.testid)).toEqual(['check-issue-speed_first_screen_heavy', 'check-issue-speed_page_heavy', 'check-issue-speed_no_smaller_copies'])
    // Speed issues are not repeated in the severity groups.
    expect(screen.queryByRole('list', { name: 'Errors' })).toBeNull()
    await userEvent.click(within(rows[0]!).getByRole('button', { name: /^Use a smaller picture:/ }))
    expect(onFix).toHaveBeenCalledWith(expect.objectContaining({ code: 'speed_first_screen_heavy', fix: expect.objectContaining({ field: 'media_id' }) }))
  })

  it('a light page scores 100', () => {
    render(<CheckPanel check={pageCheck([])} labelOf={() => null} onShow={vi.fn()} onFix={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByRole('meter', { name: 'Speed score' })).toHaveAttribute('aria-valuenow', '100')
    expect(screen.getByTestId('speed-rating')).toHaveTextContent('Fast')
    expect(screen.queryByRole('list', { name: 'Speed' })).toBeNull()
    expect(screen.getByText(/Nothing to fix/)).toBeInTheDocument()
  })
})
