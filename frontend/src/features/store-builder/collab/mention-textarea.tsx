import { useDeferredValue, useId, useRef, useState, type KeyboardEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { COMMENT_MAX, collabKeys, fetchMentionable, type Person } from './collab-api'
import { avatarColor, initials, insertMention, mentionQuery } from './collab-model'

/*
 * B16: a comment box with @mention suggestions (staff who can view the store builder). The
 * textarea is a combobox: typing "@" and a few letters opens the list; ↑ / ↓ choose, Enter or Tab
 * picks, Esc closes it. Ctrl/Cmd+Enter sends the comment.
 */

type Props = {
  value: string
  onChange: (value: string) => void
  onPick: (person: Person) => void
  onSubmit: () => void
  onCancel?: () => void
  label: string
  placeholder?: string
  autoFocus?: boolean
  describedBy?: string
  invalid?: boolean
  testId?: string
}

export function MentionTextarea({ value, onChange, onPick, onSubmit, onCancel, label, placeholder, autoFocus, describedBy, invalid, testId }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const listId = useId()
  const [at, setAt] = useState<{ start: number; query: string } | null>(null)
  const [active, setActive] = useState(0)
  const deferred = useDeferredValue(at?.query ?? null)
  const people = useQuery({
    queryKey: collabKeys.mentionable(deferred ?? ''),
    queryFn: ({ signal }) => fetchMentionable(deferred ?? '', signal),
    enabled: deferred !== null,
    staleTime: 60_000,
    retry: false,
  })
  const options = at ? (people.data ?? []).slice(0, 8) : []
  const expanded = at !== null && options.length > 0
  const current = expanded ? Math.min(active, options.length - 1) : -1

  const track = (text: string, caret: number) => {
    const next = mentionQuery(text, caret)
    setAt(next)
    if (next?.query !== at?.query) setActive(0)
  }

  const pick = (person: Person) => {
    if (!at) return
    const result = insertMention(value, at, person.name)
    onChange(result.text)
    onPick(person)
    setAt(null)
    requestAnimationFrame(() => {
      const el = ref.current
      if (!el) return
      el.focus()
      el.setSelectionRange(result.caret, result.caret)
    })
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (expanded) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        setActive((i) => (i + (event.key === 'ArrowDown' ? 1 : options.length - 1)) % options.length)
        return
      }
      if ((event.key === 'Enter' && !event.ctrlKey && !event.metaKey) || event.key === 'Tab') {
        event.preventDefault()
        const person = options[current]
        if (person) pick(person)
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        setAt(null)
        return
      }
    }
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault()
      onSubmit()
      return
    }
    if (event.key === 'Escape' && onCancel) {
      event.preventDefault()
      event.stopPropagation()
      onCancel()
    }
  }

  return (
    <div className="relative">
      <Textarea
        ref={ref}
        value={value}
        rows={3}
        maxLength={COMMENT_MAX}
        aria-label={label}
        placeholder={placeholder}
        autoFocus={autoFocus}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={expanded}
        aria-controls={expanded ? listId : undefined}
        aria-activedescendant={expanded && current >= 0 ? `${listId}-${current}` : undefined}
        aria-describedby={describedBy}
        aria-invalid={invalid ? true : undefined}
        data-testid={testId}
        className="min-h-20 resize-y text-sm"
        onChange={(e) => {
          onChange(e.target.value)
          track(e.target.value, e.target.selectionStart ?? e.target.value.length)
        }}
        onKeyDown={onKeyDown}
        onClick={(e) => track(e.currentTarget.value, e.currentTarget.selectionStart ?? 0)}
        onBlur={() => setTimeout(() => setAt(null), 150)}
      />
      {expanded && (
        <ul id={listId} role="listbox" aria-label="People to mention" className="absolute top-full left-0 z-30 mt-1 max-h-56 w-full overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md">
          {options.map((person, index) => (
            <li
              key={person.id}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === current}
              className={cn('flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm', index === current && 'bg-accent text-accent-foreground')}
              onMouseDown={(e) => {
                e.preventDefault()
                pick(person)
              }}
              onMouseEnter={() => setActive(index)}
            >
              <span aria-hidden className={cn('flex size-6 items-center justify-center rounded-full text-[10px] font-semibold text-white', avatarColor(person.id))}>
                {initials(person.name)}
              </span>
              {person.name}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
