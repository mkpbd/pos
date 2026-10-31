import { ArrowDownIcon, ArrowUpIcon, CornerDownRightIcon, PlusIcon, Trash2Icon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { MediaField } from '@/features/media/components/media-picker'
import { addNode, errorKey, MAX_MENU_DEPTH, moveNode, removeNode, updateNode, type EditorNode, type NodePath } from '@/features/storefront/menu-tree'
import { cn } from '@/lib/utils'

type Props = {
  nodes: EditorNode[]
  onChange: (nodes: EditorNode[]) => void
  /** Main navigation only: top-level items may open a mega menu. */
  allowsMega: boolean
  /** Keyed like the API ("items.0.children.1.url"). */
  errors: Record<string, string>
  readOnly: boolean
}

const itemName = (path: NodePath) => `Item ${path.map((i) => i + 1).join('.')}`

function NodeEditor({ node, path, siblings, ...props }: Props & { node: EditorNode; path: NodePath; siblings: number }) {
  const { nodes, onChange, allowsMega, errors, readOnly } = props
  const name = itemName(path)
  const key = errorKey(path)
  const index = path[path.length - 1]
  const patch = (p: Parameters<typeof updateNode>[2]) => onChange(updateNode(nodes, path, p))
  const megaAllowedHere = allowsMega && path.length === 1

  return (
    <li className={cn('flex flex-col gap-2', path.length > 1 && 'border-l pl-4')}>
      <div className="flex flex-col gap-3 rounded-md border bg-card p-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <Input aria-label={`${name} label`} placeholder="Label" value={node.label} maxLength={80} disabled={readOnly} aria-invalid={errors[`${key}.label`] ? true : undefined} onChange={(e) => patch({ label: e.target.value })} />
            {errors[`${key}.label`] && <p className="text-sm text-destructive">{errors[`${key}.label`]}</p>}
          </div>
          <div className="flex flex-col gap-1">
            <Input aria-label={`${name} link`} placeholder="/sale or https://…" value={node.url} disabled={readOnly} spellCheck={false} aria-invalid={errors[`${key}.url`] ? true : undefined} onChange={(e) => patch({ url: e.target.value })} />
            {errors[`${key}.url`] && <p className="text-sm text-destructive">{errors[`${key}.url`]}</p>}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
          <div className="flex items-center gap-2">
            <Checkbox id={`${node.key}-tab`} checked={node.open_in_new_tab} disabled={readOnly} onCheckedChange={(v) => patch({ open_in_new_tab: v === true })} />
            <Label htmlFor={`${node.key}-tab`}>New tab</Label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox id={`${node.key}-visible`} checked={node.is_visible} disabled={readOnly} onCheckedChange={(v) => patch({ is_visible: v === true })} />
            <Label htmlFor={`${node.key}-visible`}>Visible</Label>
          </div>
          {megaAllowedHere && (
            <div className="flex items-center gap-2">
              <Switch id={`${node.key}-mega`} checked={node.is_mega} disabled={readOnly} onCheckedChange={(v) => patch({ is_mega: v, mega_columns: v ? (node.mega_columns ?? 4) : null })} />
              <Label htmlFor={`${node.key}-mega`}>Mega menu</Label>
            </div>
          )}
          {errors[`${key}.is_mega`] && <p className="w-full text-sm text-destructive">{errors[`${key}.is_mega`]}</p>}

          {!readOnly && (
            <div className="ml-auto flex items-center">
              <Button type="button" variant="ghost" size="icon-sm" aria-label={`Move ${name} up`} disabled={index === 0} onClick={() => onChange(moveNode(nodes, path, -1))}><ArrowUpIcon /></Button>
              <Button type="button" variant="ghost" size="icon-sm" aria-label={`Move ${name} down`} disabled={index === siblings - 1} onClick={() => onChange(moveNode(nodes, path, 1))}><ArrowDownIcon /></Button>
              {path.length < MAX_MENU_DEPTH && (
                <Button type="button" variant="ghost" size="sm" aria-label={`Add child to ${name}`} onClick={() => onChange(addNode(nodes, path))}>
                  <CornerDownRightIcon data-icon="inline-start" /> Child
                </Button>
              )}
              <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove ${name}`} onClick={() => onChange(removeNode(nodes, path))}><Trash2Icon /></Button>
            </div>
          )}
        </div>

        {megaAllowedHere && node.is_mega && (
          <div className="flex flex-wrap items-end gap-4 rounded-md bg-muted/50 p-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${node.key}-cols`}>Columns</Label>
              <Select value={String(node.mega_columns ?? 4)} onValueChange={(v) => patch({ mega_columns: Number(v) })} disabled={readOnly}>
                <SelectTrigger id={`${node.key}-cols`} className="w-24"><SelectValue /></SelectTrigger>
                <SelectContent>{[2, 3, 4].map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Promotion image</Label>
              <MediaField value={node.image_media_id} onChange={(id) => patch({ image_media_id: id })} title="Mega menu image" disabled={readOnly} />
            </div>
          </div>
        )}
      </div>

      {node.children.length > 0 && (
        <ul className="flex flex-col gap-2" aria-label={`${name} children`}>
          {node.children.map((child, i) => <NodeEditor key={child.key} {...props} node={child} path={[...path, i]} siblings={node.children.length} />)}
        </ul>
      )}
    </li>
  )
}

export function MenuTreeEditor(props: Props) {
  const { nodes, onChange, readOnly } = props

  return (
    <div className="flex flex-col gap-3">
      {nodes.length === 0 ? (
        <p className="text-sm text-muted-foreground">This menu has no items yet.</p>
      ) : (
        <ul className="flex flex-col gap-2" aria-label="Menu items">
          {nodes.map((node, i) => <NodeEditor key={node.key} {...props} node={node} path={[i]} siblings={nodes.length} />)}
        </ul>
      )}
      {!readOnly && (
        <Button type="button" variant="outline" className="self-start" onClick={() => onChange(addNode(nodes, []))}>
          <PlusIcon data-icon="inline-start" /> Add item
        </Button>
      )}
    </div>
  )
}
