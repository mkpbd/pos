import { lazy, Suspense, useContext, useMemo } from 'react'
import { isMarkState, PageCtx } from '../../render-context'
import { DraftPlaceholder, PreviewMark } from '../../preview-mark'
import type { RenderElement } from '../../types'
import { isChartStoreData } from '../guards'
import { chartDataSource, chartModel } from './model'

/*
 * The `chart` element (contract §3). This entry is tiny (no d3): it reads the props and lazy-loads
 * the chart chunk (d3-scale / d3-shape / d3-array + the figure). Until the chunk arrives the figure
 * keeps its place at the chart's height, so the page does not jump.
 *
 * B8a store sources (`data_source` other than `manual`): the numbers come from the server-resolved
 * `data[id]` (`{labels, series}`), never from the authored grid. Without that data, or with a
 * `state` (draft only, e.g. `empty`), visitors see nothing and a draft keeps a marked place.
 */

const ChartFigure = lazy(() => import('./chart-figure'))

export function ChartElement({ element }: { element: RenderElement }) {
  const props = element.type === 'chart' ? (element.props as unknown) : null
  const page = useContext(PageCtx)
  const source = chartDataSource(props)
  const entry = source !== 'manual' && page && Object.hasOwn(page.page.data ?? {}, element.id) ? page.page.data[element.id] : undefined
  const store = entry && isChartStoreData(entry) ? entry : null
  const model = useMemo(() => (props ? chartModel(props, store) : null), [props, store])
  if (element.type !== 'chart') return null
  const state = store && isMarkState(store.state) ? store.state : null
  if (!model) return page?.draft ? <DraftPlaceholder element={element} state={state ?? 'empty'} /> : null
  if (state && !page?.draft) return null
  return (
    <PreviewMark state={state}>
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
    </PreviewMark>
  )
}
