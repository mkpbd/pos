import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SafeMarkdown } from '@/features/ai/components/safe-markdown'
import { inlineText, parseInline, parseMarkdown } from '@/features/ai/markdown'

function renderMarkdown(text: string) {
  const { container } = render(<SafeMarkdown text={text} />)
  return container.querySelector('[data-testid="ai-markdown"]') as HTMLElement
}

describe('parseMarkdown', () => {
  it('splits paragraphs on blank lines and keeps single newlines as line breaks', () => {
    const blocks = parseMarkdown('First line\nsecond line\n\nNew paragraph')
    expect(blocks.map((b) => b.type)).toEqual(['paragraph', 'paragraph'])
    expect(blocks[0]).toEqual({ type: 'paragraph', children: [{ type: 'text', value: 'First line' }, { type: 'br' }, { type: 'text', value: 'second line' }] })
  })

  it('parses bullet and numbered lists with their start number', () => {
    const blocks = parseMarkdown('- Rice\n* Oil\n+ Salt\n\n3. Third\n4) Fourth')
    expect(blocks).toHaveLength(2)
    expect(blocks[0]).toMatchObject({ type: 'list', ordered: false })
    expect(blocks[0]?.type === 'list' && blocks[0].items.map(inlineText)).toEqual(['Rice', 'Oil', 'Salt'])
    expect(blocks[1]).toMatchObject({ type: 'list', ordered: true, start: 3 })
  })

  it('parses bold, italic and inline code, nested and in Bangla', () => {
    expect(parseInline('**বিক্রি** বেড়েছে *১২%* `sales_daily`')).toEqual([
      { type: 'strong', children: [{ type: 'text', value: 'বিক্রি' }] },
      { type: 'text', value: ' বেড়েছে ' },
      { type: 'em', children: [{ type: 'text', value: '১২%' }] },
      { type: 'text', value: ' ' },
      { type: 'code', value: 'sales_daily' },
    ])
    expect(parseInline('**bold with *italic* inside**')).toEqual([
      { type: 'strong', children: [{ type: 'text', value: 'bold with ' }, { type: 'em', children: [{ type: 'text', value: 'italic' }] }, { type: 'text', value: ' inside' }] },
    ])
  })

  it('leaves unmatched or spaced markers, snake_case and escapes as text', () => {
    expect(parseInline('2 * 3 * 4')).toEqual([{ type: 'text', value: '2 * 3 * 4' }])
    expect(parseInline('net_sales_by_day')).toEqual([{ type: 'text', value: 'net_sales_by_day' }])
    expect(parseInline('**open')).toEqual([{ type: 'text', value: '**open' }])
    expect(parseInline('\\*not italic\\*')).toEqual([{ type: 'text', value: '*not italic*' }])
  })

  it('parses pipe tables, padding short rows to the header width', () => {
    const [table] = parseMarkdown('| Product | Net sales |\n|---|---:|\n| Rice | 1,200.00 |\n| Oil |')
    expect(table?.type).toBe('table')
    if (table?.type !== 'table') return
    expect(table.header.map(inlineText)).toEqual(['Product', 'Net sales'])
    expect(table.rows.map((r) => r.map(inlineText))).toEqual([['Rice', '1,200.00'], ['Oil', '']])
  })

  it('keeps fenced code verbatim and turns headings into bold lines', () => {
    const blocks = parseMarkdown('## Summary\n```\n<b>raw</b> **x**\n```')
    expect(blocks[0]).toEqual({ type: 'heading', children: [{ type: 'text', value: 'Summary' }] })
    expect(blocks[1]).toEqual({ type: 'code', value: '<b>raw</b> **x**' })
  })

  it('never throws on odd input', () => {
    for (const input of ['', '|', '|---|', '```', '- ', '1.', '**', '`', '\\', '\u0000', 'a'.repeat(30_000)]) {
      expect(() => parseMarkdown(input)).not.toThrow()
    }
  })
})

describe('SafeMarkdown (escaping)', () => {
  it('renders raw HTML as literal text, never as elements', () => {
    const root = renderMarkdown('<script>alert(1)</script>\n\n<img src=x onerror="alert(2)"> and <b>bold?</b>')
    expect(root.querySelector('script')).toBeNull()
    expect(root.querySelector('img')).toBeNull()
    expect(root.querySelector('b')).toBeNull()
    expect(root).toHaveTextContent('<script>alert(1)</script>')
    expect(root).toHaveTextContent('<img src=x onerror="alert(2)"> and <b>bold?</b>')
  })

  it('does not build links from model output (javascript: or otherwise)', () => {
    const root = renderMarkdown('Click [here](javascript:alert(1)) or [report](/reports/sales_daily) ![x](https://evil.test/x.png)')
    expect(root.querySelector('a')).toBeNull()
    expect(root.querySelector('img')).toBeNull()
    expect(root).toHaveTextContent('Click here or report x')
  })

  it('escapes HTML inside formatting, table cells, list items and code', () => {
    const root = renderMarkdown('**<i>x</i>**\n\n- <iframe src="evil">\n\n| a |\n|---|\n| <svg onload=alert(1)> |\n\n`<style>body{}</style>`')
    expect(root.querySelector('i, iframe, svg, style')).toBeNull()
    expect(within(root).getByText('<i>x</i>').tagName).toBe('STRONG')
    expect(within(root).getByRole('listitem')).toHaveTextContent('<iframe src="evil">')
    expect(within(root).getByRole('cell')).toHaveTextContent('<svg onload=alert(1)>')
    expect(within(root).getByText('<style>body{}</style>').tagName).toBe('CODE')
  })

  it('treats entities literally instead of decoding them', () => {
    const root = renderMarkdown('&lt;script&gt; &amp; &#60;')
    expect(root).toHaveTextContent('&lt;script&gt; &amp; &#60;')
  })

  it('renders lists, bold, code and tables as real elements', () => {
    render(<SafeMarkdown text={'Sales rose **12%**.\n\n1. Rice\n2. Oil\n\n| Product | Qty |\n|---|---|\n| Rice | `40` |'} />)
    expect(screen.getByText('12%').tagName).toBe('STRONG')
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Rice', 'Oil'])
    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Product' })).toBeInTheDocument()
    expect(screen.getByText('40').tagName).toBe('CODE')
  })
})
