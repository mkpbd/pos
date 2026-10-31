import { useState } from 'react'
import { useSearchParams } from 'react-router'
import { Loader2Icon, PlusIcon, Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { FormField } from '@/components/common/form-field'
import { ErrorState, LoadingState } from '@/components/common/state-views'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { useCan } from '@/features/auth/use-auth'
import {
  MENU_LOCATION_LABELS,
  MENU_LOCATIONS,
  useDeleteMenuMutation,
  useLinkTargetsQuery,
  useMenuQuery,
  useMenusQuery,
  useReplaceMenuItemsMutation,
  useSaveMenuMutation,
  type MenuDetail,
  type MenuLocation,
  type MenuSummary,
} from '@/features/storefront/api'
import { MenuTreeEditor } from '@/features/storefront/components/menu-tree-editor'
import { StorefrontHeader } from '@/features/storefront/components/storefront-header'
import { countNodes, fromApi, MAX_MENU_ITEMS, toApi, validateTree, type EditorNode } from '@/features/storefront/menu-tree'
import { fieldErrorMap } from '@/lib/forms'
import { cn } from '@/lib/utils'

function CreateMenuDialog({ location, onClose, onCreated }: { location: MenuLocation | null; onClose: () => void; onCreated: (menu: MenuDetail) => void }) {
  const save = useSaveMenuMutation()
  const [name, setName] = useState('')
  const [error, setError] = useState<string | undefined>()
  const [seededFor, setSeededFor] = useState<MenuLocation | null>(null)
  if (location && seededFor !== location) {
    setSeededFor(location)
    setName(MENU_LOCATION_LABELS[location])
    setError(undefined)
  }

  return (
    <Dialog open={location !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New menu</DialogTitle>
          <DialogDescription>{location && `Shown in: ${MENU_LOCATION_LABELS[location]}.`}</DialogDescription>
        </DialogHeader>
        <form
          id="create-menu-form"
          noValidate
          onSubmit={(e) => {
            e.preventDefault()
            if (!location) return
            if (!name.trim()) return setError('Required.')
            save.mutate(
              { input: { name: name.trim(), location } },
              {
                onSuccess: (menu) => {
                  toast.success(`${menu.name} created.`)
                  onCreated(menu)
                },
                onError: (err) => {
                  const map = fieldErrorMap(err)
                  setError(map.name ?? map.location ?? map.form)
                },
              },
            )
          }}
        >
          <FormField label="Name" error={error}><Input autoFocus maxLength={80} value={name} onChange={(e) => setName(e.target.value)} /></FormField>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="create-menu-form" disabled={save.isPending}>
            {save.isPending && <Loader2Icon data-icon="inline-start" className="animate-spin" />}
            Create menu
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function MenuEditor({ menu, canManage, onDeleted }: { menu: MenuDetail; canManage: boolean; onDeleted: () => void }) {
  const saveMenu = useSaveMenuMutation()
  const linkTargets = useLinkTargetsQuery()
  const replaceItems = useReplaceMenuItemsMutation(menu.id)
  const remove = useDeleteMenuMutation()
  const [nodes, setNodes] = useState<EditorNode[]>(() => fromApi(menu.items))
  const [name, setName] = useState(menu.name)
  const [dirty, setDirty] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [deleting, setDeleting] = useState(false)
  const allowsMega = menu.location === 'main'
  const total = countNodes(nodes)

  const change = (next: EditorNode[]) => {
    setNodes(next)
    setDirty(true)
  }

  const saveItems = () => {
    const local = validateTree(nodes, allowsMega)
    setErrors(local)
    if (Object.keys(local).length > 0) return toast.error('Please correct the highlighted items.')
    if (total > MAX_MENU_ITEMS) return toast.error(`A menu can have at most ${MAX_MENU_ITEMS} items.`)

    replaceItems.mutate(toApi(nodes), {
      onSuccess: (saved) => {
        setNodes(fromApi(saved.items))
        setDirty(false)
        toast.success('Menu items saved.')
      },
      onError: (e) => {
        const map = fieldErrorMap(e)
        setErrors(map)
        toast.error(map.form ?? 'Please correct the highlighted items.')
      },
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          {menu.name} <Badge variant="outline">{menu.location_label}</Badge>
          {!menu.is_active && <Badge variant="warning">Hidden</Badge>}
        </CardTitle>
        <CardDescription>Link to a content page, or type a site path (/sale) or full web address. Links to pages follow renames and appear once the page is published. Up to {MAX_MENU_ITEMS} items, three levels deep.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {canManage && (
          <div className="flex flex-wrap items-end gap-3">
            <FormField label="Menu name" className="min-w-56 flex-1">
              <Input maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
            </FormField>
            <Button
              type="button"
              variant="outline"
              disabled={saveMenu.isPending || !name.trim() || name.trim() === menu.name}
              onClick={() => saveMenu.mutate({ id: menu.id, input: { name: name.trim() } }, { onSuccess: () => toast.success('Menu renamed.'), onError: (e) => toast.error(e.message) })}
            >
              Rename
            </Button>
            <div className="flex items-center gap-2 pb-2">
              <Switch
                id="menu-active"
                checked={menu.is_active}
                disabled={saveMenu.isPending}
                onCheckedChange={(v) => saveMenu.mutate({ id: menu.id, input: { is_active: v } }, { onSuccess: () => toast.success(v ? 'Menu shown.' : 'Menu hidden.'), onError: (e) => toast.error(e.message) })}
              />
              <Label htmlFor="menu-active">Shown on the storefront</Label>
            </div>
            <Button type="button" variant="ghost" className="text-destructive" onClick={() => setDeleting(true)}>
              <Trash2Icon data-icon="inline-start" /> Delete menu
            </Button>
          </div>
        )}

        <MenuTreeEditor nodes={nodes} onChange={change} allowsMega={allowsMega} errors={errors} readOnly={!canManage} pages={linkTargets.data?.pages ?? []} />

        {canManage && (
          <div className="flex items-center justify-end gap-3 border-t pt-4">
            <span className="text-sm text-muted-foreground">{total} item{total === 1 ? '' : 's'}{dirty ? ' · unsaved changes' : ''}</span>
            <Button
              type="button"
              variant="outline"
              disabled={!dirty || replaceItems.isPending}
              onClick={() => {
                setNodes(fromApi(menu.items))
                setErrors({})
                setDirty(false)
              }}
            >
              Discard
            </Button>
            <Button type="button" disabled={!dirty || replaceItems.isPending} onClick={saveItems}>
              {replaceItems.isPending && <Loader2Icon data-icon="inline-start" className="animate-spin" />}
              Save items
            </Button>
          </div>
        )}

        <ConfirmDialog
          open={deleting}
          onOpenChange={setDeleting}
          title={`Delete ${menu.name}?`}
          description="The menu and all its items are removed from the storefront."
          confirmLabel="Delete"
          pending={remove.isPending}
          onConfirm={() =>
            remove.mutate(menu.id, {
              onSuccess: () => {
                toast.success(`${menu.name} deleted.`)
                onDeleted()
              },
              onError: (e) => toast.error(e.message),
              onSettled: () => setDeleting(false),
            })
          }
        />
      </CardContent>
    </Card>
  )
}

export function MenusPage() {
  const can = useCan()
  const canManage = can('storefront.manage')
  const menus = useMenusQuery()
  const [params, setParams] = useSearchParams()
  const [creating, setCreating] = useState<MenuLocation | null>(null)

  const byLocation = new Map<MenuLocation, MenuSummary>((menus.data ?? []).map((m) => [m.location, m]))
  const selectedId = params.get('menu') ?? menus.data?.[0]?.id ?? null
  const menu = useMenuQuery(selectedId)
  const select = (id: string | null) => setParams(id ? { menu: id } : {}, { replace: true })

  return (
    <div className="flex flex-col gap-6">
      <StorefrontHeader />
      {menus.isPending ? (
        <LoadingState rows={4} label="Loading menus" />
      ) : menus.error ? (
        <ErrorState error={menus.error} onRetry={() => menus.refetch()} />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[18rem_1fr]">
          <nav aria-label="Menu locations">
            <ul className="flex flex-col gap-1">
              {MENU_LOCATIONS.map((location) => {
                const m = byLocation.get(location)
                return (
                  <li key={location} className="flex items-center justify-between gap-2 rounded-md">
                    {m ? (
                      <button
                        type="button"
                        onClick={() => select(m.id)}
                        aria-current={m.id === selectedId ? 'page' : undefined}
                        className={cn('flex w-full flex-col rounded-md px-3 py-2 text-left text-sm hover:bg-muted', m.id === selectedId && 'bg-muted font-medium')}
                      >
                        <span>{m.name}</span>
                        <span className="text-xs text-muted-foreground">{MENU_LOCATION_LABELS[location]}{m.is_active ? '' : ' · hidden'}</span>
                      </button>
                    ) : (
                      <div className="flex w-full items-center justify-between px-3 py-2 text-sm text-muted-foreground">
                        <span>{MENU_LOCATION_LABELS[location]}</span>
                        {canManage && (
                          <Button type="button" variant="ghost" size="sm" aria-label={`Create ${MENU_LOCATION_LABELS[location]} menu`} onClick={() => setCreating(location)}>
                            <PlusIcon data-icon="inline-start" /> Create
                          </Button>
                        )}
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          </nav>

          {selectedId === null ? (
            <p className="text-sm text-muted-foreground">No menus yet.{canManage ? ' Create one for a location on the left.' : ''}</p>
          ) : menu.isPending ? (
            <LoadingState rows={4} label="Loading menu" />
          ) : menu.error ? (
            <ErrorState error={menu.error} onRetry={() => menu.refetch()} />
          ) : (
            // Keyed by menu so switching menus reseeds the editor (renaming keeps unsaved item edits).
            <MenuEditor key={menu.data.id} menu={menu.data} canManage={canManage} onDeleted={() => select(null)} />
          )}
        </div>
      )}

      <CreateMenuDialog
        location={creating}
        onClose={() => setCreating(null)}
        onCreated={(m) => {
          setCreating(null)
          select(m.id)
        }}
      />
    </div>
  )
}
