/*
 * Content tab forms of the B8a trust & people elements and progress bars (contract §1): team
 * (members with their links), review wall, photo grid, store hours and progress bars.
 */

import { useCurrentUserQuery } from '@/features/auth/api'
import type { Element, PhotoGridElement, PhotoGridImage, ProgressBarsElement, ProgressItem, ReviewWallElement, StoreHoursElement, TeamElement, TeamLink, TeamLinkKind, TeamMember } from '@/storefront/builder/types'
import { B8A_LIMITS, B8A_TEXT_LIMITS } from '@/storefront/builder/validate'
import { moveItemTranslations, type ItemListChange } from './b6-model'
import { emailOf, emailUrl, LINK_KINDS, linkKindLabel, teamLinkProblem } from './b8a-model'
import { ImageChooser, LinkField } from './fields'
import { Bangla, DeviceColumnsField, ImageListBangla, ImageListField, ItemBangla, Note, NumberField } from './form-kit'
import { itemErrors, limitIn, patch, setList, type ElementFormProps } from './form-model'
import { ItemList } from './item-list'
import { ChoiceField, SingleProductPicker, TextField, ToggleField } from './pickers'
import { StoreHoursEditor } from './store-hours-editor'
import { DataStateHint } from './data-hint'

type Props<N> = ElementFormProps<N>

const TEXT = B8A_TEXT_LIMITS as Record<string, Record<string, number>>
const limit = (type: string, field: string) => limitIn(TEXT, type, field)

/* ----------------------------------------------------------------------------------------------
 * Team
 * -------------------------------------------------------------------------------------------- */

function TeamLinkFields({ link, update, error }: { link: TeamLink; update: (patch: Partial<TeamLink>, coalesce?: string) => void; error?: string }) {
  const email = link.kind === 'email'
  // Show the rule's message as soon as something is typed; the validator reports it on save too.
  const problem = link.url === '' || link.url === 'mailto:' ? undefined : (teamLinkProblem(link.kind, link.url) ?? undefined)
  return (
    <>
      <ChoiceField<TeamLinkKind>
        label="Kind"
        value={link.kind}
        options={LINK_KINDS}
        onChange={(kind) => update({ kind, url: kind === 'email' ? (email ? link.url : '') : email ? '' : link.url })}
      />
      {email ? (
        <TextField label="Email address" placeholder="hello@myshop.com" value={emailOf(link.url)} max={200} error={error ?? problem} onChange={(address) => update({ url: emailUrl(address) }, 'url')} />
      ) : (
        <TextField label="Page address" placeholder="https://www.instagram.com/yourshop" hint="Starts with https://." value={link.url} max={2048} error={error ?? problem} onChange={(url) => update({ url: url.trim() }, 'url')} />
      )}
    </>
  )
}

export function TeamForm(props: Props<TeamElement>) {
  const { node, onChange, errors } = props
  const p = node.props
  const L = (field: string) => limit('team', `members.*.${field}`)
  const setLinks = (memberId: string, links: TeamLink[], change?: ItemListChange) => {
    const members = p.members.map((m) => (m.id === memberId ? { ...m, links } : m))
    onChange(
      { ...node, props: { ...p, members }, translations: moveItemTranslations(node.translations, `members.${memberId}.links`, change) },
      change?.typing ? { coalesceKey: `${node.id}:members:${memberId}:links:${change.typing}` } : undefined,
    )
  }
  return (
    <div className="flex flex-col gap-4">
      <ItemList<TeamMember>
        label="People"
        noun="person"
        items={p.members}
        min={B8A_LIMITS.teamMembers.min}
        max={B8A_LIMITS.teamMembers.max}
        errors={errors}
        errorPrefix="members"
        create={(id) => ({ id, media_id: null, name: 'New person', role: '', bio: '', links: [] })}
        summary={(m) => [m.name, m.role].filter(Boolean).join(' · ')}
        onChange={(members, change) => setList(node, onChange, 'members', members, change)}
      >
        {(member, i, update) => {
          const e = itemErrors(errors, 'members', i)
          return (
            <>
              <div className="flex flex-col gap-1.5">
                <span className="text-sm font-medium">Photo</span>
                <ImageChooser
                  title="Choose a photo"
                  value={member.media_id}
                  error={e.media_id}
                  onChange={(media_id, ref) =>
                    onChange(
                      { ...node, props: { ...p, members: p.members.map((m) => (m.id === member.id ? { ...m, media_id } : m)) } },
                      ref ? { media: { [ref.id]: ref } } : undefined,
                    )
                  }
                />
                <Note>Optional. Without a photo, the person’s initials are shown.</Note>
              </div>
              <TextField label="Name" hint="Names aren’t translated." value={member.name} max={L('name')} error={e.name} onChange={(name) => update({ name }, 'name')} />
              <TextField label="Role" hint="Optional, e.g. “Founder” or “Head baker”." value={member.role} max={L('role')} error={e.role} onChange={(role) => update({ role }, 'role')} />
              <TextField label="About" multiline hint="Optional: a sentence or two." value={member.bio} max={L('bio')} error={e.bio} onChange={(bio) => update({ bio }, 'bio')} />
              <ItemList<TeamLink>
                label="Links"
                noun="link"
                items={member.links}
                min={B8A_LIMITS.teamLinks.min}
                max={B8A_LIMITS.teamLinks.max}
                errors={e}
                errorPrefix="links"
                create={(id) => ({ id, kind: 'instagram', url: '' })}
                summary={(link) => `${linkKindLabel(link.kind)}${link.url ? `: ${link.kind === 'email' ? emailOf(link.url) : link.url.replace(/^https:\/\/(www\.)?/, '')}` : ''}`}
                onChange={(links, change) => setLinks(member.id, links, change)}
              >
                {(link, l, updateLink) => <TeamLinkFields link={link} update={updateLink} error={itemErrors(e, 'links', l).url ?? itemErrors(e, 'links', l).kind} />}
              </ItemList>
              <ItemBangla
                {...props}
                list="members"
                itemId={member.id}
                fields={[
                  { name: 'role', label: 'Role', base: member.role },
                  { name: 'bio', label: 'About', base: member.bio, kind: 'textarea' },
                ]}
              />
            </>
          )
        }}
      </ItemList>
      <DeviceColumnsField label="People per row" noun="People" value={p.columns} base={B8A_LIMITS.teamColumns} error={errors['columns.base'] ?? errors['columns.tablet'] ?? errors['columns.mobile']} onChange={(columns) => patch(node, onChange, { columns })} />
      <ChoiceField
        label="Look"
        value={p.style}
        error={errors.style}
        options={[{ value: 'card', label: 'Cards' }, { value: 'plain', label: 'Plain' }, { value: 'circle', label: 'Round photos' }]}
        onChange={(style) => patch(node, onChange, { style })}
      />
      <Note>Link icons are named for screen readers, e.g. “Rina on Instagram”.</Note>
    </div>
  )
}

/* ----------------------------------------------------------------------------------------------
 * Review wall
 * -------------------------------------------------------------------------------------------- */

export function ReviewWallForm(props: Props<ReviewWallElement>) {
  const { node, onChange, errors } = props
  const p = node.props
  return (
    <div className="flex flex-col gap-4">
      <TextField label="Title" value={p.title} max={limit('review_wall', 'title')} error={errors.title} onChange={(title) => patch(node, onChange, { title }, 'title')} />
      <ChoiceField
        label="Which reviews"
        value={p.source}
        error={errors.source}
        options={[{ value: 'latest', label: 'The newest' }, { value: 'top_rated', label: 'The best rated' }, { value: 'product', label: 'Of one product' }]}
        onChange={(source) => patch(node, onChange, { source, product_id: source === 'product' ? p.product_id : null })}
      />
      {p.source === 'product' && <SingleProductPicker value={p.product_id} error={errors.product_id} onChange={(product_id) => patch(node, onChange, { product_id })} />}
      <ChoiceField
        label="Lowest rating shown"
        value={String(p.min_rating)}
        error={errors.min_rating}
        options={[5, 4, 3, 2, 1].map((n) => ({ value: String(n), label: n === 5 ? '5 stars only' : n === 1 ? 'All ratings' : `${n} stars and up` }))}
        onChange={(v) => patch(node, onChange, { min_rating: Number(v) })}
      />
      <NumberField
        label="At most this many reviews"
        value={p.limit}
        min={B8A_LIMITS.reviewLimit.min}
        max={B8A_LIMITS.reviewLimit.max}
        hint={`${B8A_LIMITS.reviewLimit.min}–${B8A_LIMITS.reviewLimit.max}.`}
        error={errors.limit}
        onChange={(n) => patch(node, onChange, { limit: n }, 'limit')}
      />
      <ChoiceField label="Layout" value={p.layout} error={errors.layout} options={[{ value: 'grid', label: 'Grid' }, { value: 'carousel', label: 'Sliding row' }]} onChange={(layout) => patch(node, onChange, { layout })} />
      <ToggleField label="Show which product was reviewed" checked={p.show_product} onChange={(show_product) => patch(node, onChange, { show_product })} />
      <ToggleField label="Show the average rating" checked={p.show_summary} onChange={(show_summary) => patch(node, onChange, { show_summary })} />
      {!props.setup && <DataStateHint node={node} />}
      <Note>Only approved reviews of products on sale online are shown, with the reviewer’s public name. With no matching reviews the block stays hidden.</Note>
      <Bangla {...props} fields={[{ name: 'title', label: 'Title', base: p.title }]} />
    </div>
  )
}

/* ----------------------------------------------------------------------------------------------
 * Photo grid
 * -------------------------------------------------------------------------------------------- */

export function PhotoGridForm(props: Props<PhotoGridElement>) {
  const { node, onChange, errors } = props
  const p = node.props
  return (
    <div className="flex flex-col gap-4">
      <ImageListField<PhotoGridImage>
        label="Photos"
        noun="photo"
        list="images"
        items={p.images}
        range={B8A_LIMITS.photoImages}
        errors={errors}
        make={(id, media, media_id) => ({ id, media_id, alt: media?.alt ?? '', link: null })}
        onChange={(images, change, media) => setList(node, onChange, 'images', images, change, media)}
      >
        {(item, i, update) => {
          const e = itemErrors(errors, 'images', i)
          return (
            <>
              <TextField label="Description (alt text)" hint="Describes the photo for screen readers." value={item.alt} max={limit('photo_grid', 'images.*.alt')} error={e.alt} onChange={(alt) => update({ alt }, 'alt')} />
              <LinkField label="Link" value={item.link?.url ?? null} error={e.link} hint="Optional, e.g. the Instagram post. Other websites open in a new tab." onChange={(url) => update({ link: url === null ? null : { url } }, 'link')} />
              <ImageListBangla {...props} list="images" item={item} captions={false} />
            </>
          )
        }}
      </ImageListField>
      <DeviceColumnsField label="Photos per row" noun="Photos" value={p.columns} base={B8A_LIMITS.photoColumns} error={errors['columns.base'] ?? errors['columns.tablet'] ?? errors['columns.mobile']} onChange={(columns) => patch(node, onChange, { columns })} />
      <ChoiceField label="Space between" value={p.gap} error={errors.gap} options={[{ value: 'none', label: 'None' }, { value: 'sm', label: 'Small' }, { value: 'md', label: 'Medium' }]} onChange={(gap) => patch(node, onChange, { gap })} />
      <ChoiceField
        label="When pointed at"
        value={p.hover}
        error={errors.hover}
        options={[{ value: 'none', label: 'Nothing' }, { value: 'zoom', label: 'Zoom in a little' }, { value: 'overlay', label: 'Darken and show the description' }]}
        onChange={(hover) => patch(node, onChange, { hover })}
      />
      <ToggleField
        label="Show a profile link"
        hint="A link to your page, e.g. “@littlesprouts” on Instagram."
        checked={p.profile !== null}
        onChange={(on) => patch(node, onChange, { profile: on ? { label: '@yourshop', url: 'https://www.instagram.com/' } : null })}
      />
      {p.profile !== null && (
        <>
          <TextField label="Profile name" value={p.profile.label} max={limit('photo_grid', 'profile.label')} error={errors['profile.label']} onChange={(label) => patch(node, onChange, { profile: { ...p.profile!, label } }, 'profile.label')} />
          <LinkField label="Profile link" required value={p.profile.url} error={errors['profile.url'] ?? errors.profile} onChange={(url) => patch(node, onChange, { profile: { ...p.profile!, url: url ?? '' } }, 'profile.url')} />
        </>
      )}
      <Note>Add your own photos (for example ones you posted on Instagram); nothing is loaded from Instagram itself.</Note>
      <Bangla {...props} fields={p.profile ? [{ name: 'profile.label', label: 'Profile name', base: p.profile.label }] : []} />
    </div>
  )
}

/* ----------------------------------------------------------------------------------------------
 * Store hours
 * -------------------------------------------------------------------------------------------- */

export function StoreHoursForm(props: Props<StoreHoursElement>) {
  const { node, onChange, errors } = props
  const p = node.props
  const me = useCurrentUserQuery()
  const timeZone = me.data?.organization?.timezone
  return (
    <div className="flex flex-col gap-4">
      <TextField label="Title" value={p.title} max={limit('store_hours', 'title')} error={errors.title} onChange={(title) => patch(node, onChange, { title }, 'title')} />
      <ChoiceField
        label="Week starts on"
        value={p.week_starts}
        error={errors.week_starts}
        options={[{ value: 'sat', label: 'Saturday' }, { value: 'sun', label: 'Sunday' }, { value: 'mon', label: 'Monday' }]}
        onChange={(week_starts) => patch(node, onChange, { week_starts })}
      />
      <StoreHoursEditor days={p.days} weekStarts={p.week_starts} errors={errors} onChange={(days, typing) => patch(node, onChange, { days }, typing ? `days.${typing}` : undefined)} />
      <Note>Same opening and closing time = open 24 hours. A closing time earlier than the opening time means it closes after midnight.</Note>
      <TextField label="Note" multiline hint="Optional, e.g. “Closed on Eid day”." value={p.note} max={limit('store_hours', 'note')} error={errors.note} onChange={(note) => patch(node, onChange, { note }, 'note')} />
      <ToggleField label="Show “Open now” / “Closed”" hint="Worked out for each shopper in your store’s time zone and updated every minute." checked={p.show_open_now} onChange={(show_open_now) => patch(node, onChange, { show_open_now })} />
      <ToggleField label="Mark today" hint="Today’s line gets a “Today” label." checked={p.highlight_today} onChange={(highlight_today) => patch(node, onChange, { highlight_today })} />
      {timeZone && <Note>Times are in your store’s time zone ({timeZone}).</Note>}
      <Bangla {...props} fields={[{ name: 'title', label: 'Title', base: p.title }, { name: 'note', label: 'Note', base: p.note, kind: 'textarea' }]} />
    </div>
  )
}

/* ----------------------------------------------------------------------------------------------
 * Progress bars
 * -------------------------------------------------------------------------------------------- */

export function ProgressBarsForm(props: Props<ProgressBarsElement>) {
  const { node, onChange, errors } = props
  const p = node.props
  return (
    <div className="flex flex-col gap-4">
      <ItemList<ProgressItem>
        label="Bars"
        noun="bar"
        items={p.items}
        min={B8A_LIMITS.progressItems.min}
        max={B8A_LIMITS.progressItems.max}
        errors={errors}
        create={(id) => ({ id, label: 'New bar', value: 50 })}
        summary={(item) => `${item.label} · ${item.value} %`}
        onChange={(items, change) => setList(node, onChange, 'items', items, change)}
      >
        {(item, i, update) => {
          const e = itemErrors(errors, 'items', i)
          return (
            <>
              <TextField label="Label" value={item.label} max={limit('progress_bars', 'items.*.label')} error={e.label} onChange={(label) => update({ label }, 'label')} />
              <NumberField label="Value (%)" value={item.value} min={B8A_LIMITS.progressValue.min} max={B8A_LIMITS.progressValue.max} step={0.1} decimals={1} hint="0–100, one decimal at most." error={e.value} onChange={(value) => update({ value }, 'value')} />
              <ItemBangla {...props} list="items" itemId={item.id} fields={[{ name: 'label', label: 'Label', base: item.label }]} />
            </>
          )
        }}
      </ItemList>
      <ChoiceField label="Look" value={p.style} error={errors.style} options={[{ value: 'bar', label: 'Bars' }, { value: 'ring', label: 'Rings' }]} onChange={(style) => patch(node, onChange, { style })} />
      <ToggleField label="Show the numbers" hint="Off: the numbers are still read out by screen readers." checked={p.show_value} onChange={(show_value) => patch(node, onChange, { show_value })} />
      <ToggleField label="Fill up when shown" hint="Bars fill once when shoppers scroll to them; shoppers who turned off animations see them full at once." checked={p.animate} onChange={(animate) => patch(node, onChange, { animate })} />
    </div>
  )
}

/** The B8a trust & people form for a node, or null for other types. */
export function B8aPeopleForm(props: Props<Element>) {
  const pass = <N,>() => props as unknown as Props<N>
  switch (props.node.type) {
    case 'team':
      return <TeamForm {...pass<TeamElement>()} />
    case 'review_wall':
      return <ReviewWallForm {...pass<ReviewWallElement>()} />
    case 'photo_grid':
      return <PhotoGridForm {...pass<PhotoGridElement>()} />
    case 'store_hours':
      return <StoreHoursForm {...pass<StoreHoursElement>()} />
    case 'progress_bars':
      return <ProgressBarsForm {...pass<ProgressBarsElement>()} />
    default:
      return null
  }
}
