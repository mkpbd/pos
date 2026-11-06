import { Fragment, useMemo } from 'react'
import { parseMarkdown, type Block, type Inline } from '@/features/ai/markdown'
import { cn } from '@/lib/utils'

/**
 * Renders model output with the tiny markdown subset of `parseMarkdown`. Every string becomes a
 * React text node (escaped by React); no HTML is ever injected and no link is ever built.
 */
export function SafeMarkdown({ text, className }: { text: string; className?: string }) {
  const blocks = useMemo(() => parseMarkdown(text), [text])
  return (
    <div className={cn('flex flex-col gap-3 text-sm leading-relaxed break-words', className)} data-testid="ai-markdown">
      {blocks.map((block, i) => <BlockView key={i} block={block} />)}
    </div>
  )
}

function InlineView({ nodes }: { nodes: Inline[] }) {
  return (
    <>
      {nodes.map((node, i) => {
        switch (node.type) {
          case 'text':
            return <Fragment key={i}>{node.value}</Fragment>
          case 'code':
            return <code key={i} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">{node.value}</code>
          case 'strong':
            return <strong key={i} className="font-semibold"><InlineView nodes={node.children} /></strong>
          case 'em':
            return <em key={i}><InlineView nodes={node.children} /></em>
          case 'br':
            return <br key={i} />
        }
      })}
    </>
  )
}

function BlockView({ block }: { block: Block }) {
  switch (block.type) {
    case 'paragraph':
      return <p><InlineView nodes={block.children} /></p>
    case 'heading':
      return <p className="font-semibold"><InlineView nodes={block.children} /></p>
    case 'code':
      return <pre className="overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs"><code>{block.value}</code></pre>
    case 'list': {
      const items = block.items.map((item, i) => <li key={i}><InlineView nodes={item} /></li>)
      return block.ordered ? (
        <ol className="list-decimal space-y-1 pl-5" start={block.start}>{items}</ol>
      ) : (
        <ul className="list-disc space-y-1 pl-5">{items}</ul>
      )
    }
    case 'table':
      return (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted/60">
              <tr>
                {block.header.map((cell, i) => <th key={i} scope="col" className="px-3 py-2 font-medium"><InlineView nodes={cell} /></th>)}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, r) => (
                <tr key={r} className="border-t">
                  {row.map((cell, c) => <td key={c} className="px-3 py-2 align-top"><InlineView nodes={cell} /></td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
  }
}
