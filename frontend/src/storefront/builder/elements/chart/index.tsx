import { lazy, Suspense, useContext, useMemo } from 'react'
import { PageCtx } from '../../render-context'
import { DraftPlaceholder } from '../../preview-mark'
import type { RenderElement } from '../../types'
import { chartModel } from './model'

/*
 * The `chart` element (contract §3). This entry is tiny (no d3): it reads the props and lazy-loads
 * the chart chunk (d3-scale / d3-shape / d3-array + the figure). Until the chunk arrives the figure
 * keeps its place at the chart's height, so the page does not jump.
 */

const ChartFigure = lazy(() => import('./chart-figure'))

export function ChartElement({ element }: { element: RenderElement }) {
  const props = element.type === 'chart' ? (element.props as unknown) : null
  const model = useMemo(() => (props ? chartModel(props) : null), [props])
  const page = useContext(PageCtx)
  if (element.type !== 'chart') return null
  if (!model) return page?.draft ? <DraftPlaceholder element={element} /> : null
  return (
    <Suspense
      fallback={
        <figure data-b={element.id} data-testid="builder-chart" data-loading="true" className="b-chart flex w-full flex-col gap-3" aria-busy="true">
          {model.title && <figcaption className="font-heading text-lg font-bold text-sf-heading">{model.title}</figcaption>}
          <div style={{ minHeight: model.height }} />
        </figure>
      }
    >
      <ChartFigure id={element.id} model={model} />
    </Suspense>
  )
}
