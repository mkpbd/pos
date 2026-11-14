import { isOrderFormData } from '../builder/elements/guards'
import type { BuilderPage, RenderColumn, RenderElement } from '../builder/types'

/* P2a: what the order form and the sticky "Order now" bar share. */

/** Fired by an order form once its order is placed (`detail`: the element id). */
export const ORDER_PLACED_EVENT = 'sf:order-placed'

/** The anchor id of an order form element (the bar scrolls to it). */
export function orderFormAnchor(elementId: string): string {
  return `order-form-${elementId}`
}

/** The order form elements visitors see on a page, in document order (their data must be usable). */
export function orderFormsOf(page: BuilderPage): string[] {
  const ids: string[] = []
  const visit = (columns: RenderColumn[] | undefined) => {
    for (const column of Array.isArray(columns) ? columns : []) {
      for (const element of (Array.isArray(column.elements) ? column.elements : []) as RenderElement[]) {
        if (element.hidden || element.state) continue
        if (element.type === 'order_form') {
          const data = Object.hasOwn(page.data ?? {}, element.id) ? page.data[element.id] : undefined
          if (data && isOrderFormData(data) && !data.state) ids.push(element.id)
        } else if (element.type === 'inner_row' && 'columns' in element) visit(element.columns as RenderColumn[])
      }
    }
  }
  for (const section of Array.isArray(page.sections) ? page.sections : []) if (!section.hidden && !section.state) visit(section.columns)
  return ids
}
