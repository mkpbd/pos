import type { ReactNode } from 'react'
import { useStorefront } from '../api'
import { CartButton } from '../components/header-actions'
import { MenuLink } from '../components/menu-link'
import { MobileMenu } from '../components/mobile-menu'
import { SearchPanel } from '../components/search-panel'
import { useLocale } from '../i18n/locale'
import type { MenuNode } from '../types'
import { LogoElement } from './elements/site'
import { bool, isObject, type El } from './elements/shared'
import { isMenuData } from './elements/guards'
import { PageRenderer } from './page-renderer'
import { hasPhoneSettings } from './phone-settings'
import { PhoneHeaderCtx } from './render-context'
import type { BuilderPage, RenderElement } from './types'

/*
 * B22a: the designed header on phones. It is the same header document in its phone layout:
 * - with phone settings of its own (anything set for Phone: a style, a hidden part, a column
 *   width or the phone order), the document is drawn with them, its menus as a menu button
 *   opening a drawer and its search box as a search icon (PhoneHeaderCtx);
 * - with none (the templates' case), a compact row built from its parts: the logo, a search
 *   icon, the cart and a menu button whose drawer lists the header menu's items (nested items
 *   as expandable rows). Each part carries its element's id, so the editor canvas selects it.
 */

/** The first drawn element of a type (document order; hidden, off-schedule and phone-hidden nodes are skipped). */
function firstElement<T extends RenderElement['type']>(page: BuilderPage, type: T): El<T> | null {
  const shown = (node: unknown): node is Record<string, unknown> =>
    isObject(node) && node.hidden !== true && node.state === undefined && !(isObject(node.visibility) && node.visibility.mobile === false)
  const visit = (nodes: unknown): El<T> | null => {
    if (!Array.isArray(nodes)) return null
    for (const node of nodes) {
      if (!shown(node)) continue
      if (node.type === type && typeof node.id === 'string') return node as El<T>
      const found = visit(node.columns) ?? visit(node.elements)
      if (found) return found
    }
    return null
  }
  return visit(page.sections)
}

/** The drawer's items: the header menu's (without sub-items when the element shows none), else the store's mobile / main menu. */
function drawerItems(page: BuilderPage, menu: El<'menu'> | null, fallback: MenuNode[]): MenuNode[] {
  const data = menu && Object.hasOwn(page.data ?? {}, menu.id) ? page.data[menu.id] : undefined
  if (!data || !isMenuData(data) || data.items.length === 0) return fallback
  return menu?.props?.show_children === 'none' ? data.items.map((item) => ({ ...item, children: [] })) : data.items
}

function DefaultPhoneHeader({ page, testId }: { page: BuilderPage; testId: string }) {
  const { store, menus } = useStorefront()
  const { t } = useLocale()
  const logo = firstElement(page, 'logo')
  const search = firstElement(page, 'search_box')
  const cart = firstElement(page, 'cart_icon')
  const menu = firstElement(page, 'menu')
  const items = drawerItems(page, menu, menus.mobile?.items ?? menus.main?.items ?? [])
  return (
    <div className="b-page" data-testid={testId} data-document-key={page.document?.key} data-phone-layout="default">
      <div className="flex items-center gap-0.5 px-4 py-2">
        <div className="flex min-w-0 flex-1 items-center [&_img]:max-h-10">
          {logo ? (
            <LogoElement element={logo} />
          ) : (
            <MenuLink url="/" className="truncate font-heading text-xl font-extrabold text-sf-heading" aria-label={t('common.storeHome', { store: store.name })}>
              {store.name}
            </MenuLink>
          )}
        </div>
        <div data-b={search?.id} className="inline-flex">
          <SearchPanel />
        </div>
        <div data-b={cart?.id} className="inline-flex">
          <CartButton showCount={bool(cart?.props?.show_count, true)} />
        </div>
        <div data-b={menu?.id} className="inline-flex" data-testid="phone-menu">
          <MobileMenu storeName={store.name} items={items} />
        </div>
      </div>
    </div>
  )
}

/**
 * The header document in its phone layout (store below 768 px; the editor canvas's Phone preview).
 * `scope` and `placeholder` as for PageRenderer.
 */
export function PhoneHeader({
  page,
  scope,
  placeholder,
  testId = 'builder-header',
}: {
  page: BuilderPage
  scope?: string
  placeholder?: (element: RenderElement) => ReactNode
  testId?: string
}) {
  if (!hasPhoneSettings(page)) return <DefaultPhoneHeader page={page} testId={testId} />
  return (
    <PhoneHeaderCtx value>
      <PageRenderer page={page} scope={scope} placeholder={placeholder} device="mobile" testId={testId} />
    </PhoneHeaderCtx>
  )
}
