/*
 * B8b: the Content tab of the `form` element — the form builder. Fields are a B6 item list
 * (add / remove / duplicate / reorder); each field has a kind picker with icons, its label,
 * placeholder and help, "must be filled in", its choices (drop-down, choose one, choose several),
 * a number range, a longest answer, and "reply to this address" for one e-mail field. Below: the
 * button text, the thank-you message, an optional "I agree" box, an extra e-mail for each answer
 * and the layout. Every text has its Bangla field (`fields.<id>.label`, nested
 * `fields.<id>.options.<id>.label`).
 */

import { useId, useState } from 'react'
import { TypeIcon } from 'lucide-react'
import { FormField } from '@/components/common/form-field'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { formFieldDefaults } from '@/storefront/builder/registry'
import type { Element, FormElement, FormField as FormFieldValue, FormFieldKind, FormFieldOption } from '@/storefront/builder/types'
import { B8B_LIMITS, B8B_TEXT_LIMITS, isEmailAddress } from '@/storefront/builder/validate'
import { moveItemTranslations, type ItemListChange } from './b6-model'
import { FORM_FIELD_KINDS, hasPlaceholder, isChoice, KIND_INFO, oneReplyTo, withKind } from './b8b-model'
import { FieldError, LinkField } from './fields'
import { Bangla, ItemBangla, Note } from './form-kit'
import { itemErrors, patch, type ElementFormProps } from './form-model'
import { ItemList } from './item-list'
import { ChoiceField, TextField, ToggleField } from './pickers'

export type B8bFormProps<N> = ElementFormProps<N>

const T = B8B_TEXT_LIMITS.form

/** A number that may be empty (null): decimals allowed. */
function OptionalNumber({ label, value, onChange, error, hint, integer = false }: { label: string; value: number | null; onChange: (n: number | null) => void; error?: string; hint?: string; integer?: boolean }) {
  const [text, setText] = useState(value === null ? '' : String(value))
  const [seen, setSeen] = useState(value)
  if (seen !== value) {
    setSeen(value)
    if (value === null ? text.trim() !== '' : Number(text) !== value) setText(value === null ? '' : String(value))
  }
  return (
    <FormField label={label} error={error} hint={hint}>
      <Input
        type="number"
        inputMode={integer ? 'numeric' : 'decimal'}
        step={integer ? 1 : 'any'}
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          if (e.target.value.trim() === '') return onChange(null)
          const n = Number(e.target.value)
          if (Number.isFinite(n)) onChange(integer ? Math.round(n) : Math.round(n * 100) / 100)
        }}
      />
    </FormField>
  )
}

function KindPicker({ value, onChange }: { value: FormFieldKind; onChange: (kind: FormFieldKind) => void }) {
  const name = useId()
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1 text-sm font-medium">Kind of answer</legend>
      <div className="grid grid-cols-2 gap-1.5" data-testid="field-kinds">
        {FORM_FIELD_KINDS.map(({ kind, label, hint, icon: Icon }) => (
          <label
            key={kind}
            title={hint}
            className={cn(
              'flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1.5 text-xs transition-colors has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50',
              value === kind ? 'border-primary bg-primary/5 font-medium' : 'hover:bg-muted/50',
            )}
          >
            <input type="radio" name={name} value={kind} checked={value === kind} onChange={() => onChange(kind)} className="sr-only" />
            <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            {label}
          </label>
        ))}
      </div>
      <p className="text-sm text-muted-foreground">{KIND_INFO[value].hint}</p>
    </fieldset>
  )
}

/**
 * "Also e-mail each answer": the address is stored only once it looks like one (a half-typed
 * address would stop the draft from saving); turning the switch off removes it.
 */
function NotifyEmail({ node, onChange, error }: { node: FormElement; onChange: B8bFormProps<FormElement>['onChange']; error?: string }) {
  const stored = node.props.notify_email
  const id = useId()
  const [open, setOpen] = useState(stored !== null)
  const [text, setText] = useState(stored ?? '')
  const [seen, setSeen] = useState(stored)
  if (seen !== stored) {
    setSeen(stored)
    if (stored !== null) {
      setText(stored)
      setOpen(true)
    } else if (isEmailAddress(text.trim())) setOpen(false)
  }
  const typed = text.trim()
  const local = open && typed !== '' && !isEmailAddress(typed) ? 'Enter an e-mail address such as orders@myshop.com. It is saved once it is complete.' : undefined
  return (
    <div className="flex flex-col gap-3 rounded-md border p-3">
      <ToggleField
        label="Also e-mail each answer"
        hint="Everyone allowed to see form answers gets a notice in the bell; answers are kept under Content → Form submissions."
        checked={open || stored !== null}
        onChange={(on) => {
          setOpen(on)
          if (!on) {
            setText('')
            if (stored !== null) patch(node, onChange, { notify_email: null })
          } else if (isEmailAddress(typed)) patch(node, onChange, { notify_email: typed })
        }}
      />
      {(open || stored !== null) && (
        <FormField label="E-mail address" error={local ?? error} hint={typed === '' ? 'For example orders@myshop.com.' : undefined}>
          <Input
            id={id}
            type="email"
            inputMode="email"
            autoComplete="off"
            spellCheck={false}
            maxLength={254}
            placeholder="orders@myshop.com"
            value={text}
            onChange={(event) => {
              setText(event.target.value)
              const next = event.target.value.trim()
              if (isEmailAddress(next)) patch(node, onChange, { notify_email: next }, 'notify_email')
              else if (stored !== null) patch(node, onChange, { notify_email: null }, 'notify_email')
            }}
          />
        </FormField>
      )}
    </div>
  )
}

export function FormElementForm(props: B8bFormProps<FormElement>) {
  const { node, onChange, errors } = props
  const p = node.props

  const setFields = (fields: FormFieldValue[], change?: ItemListChange) => {
    const clean = oneReplyTo(fields, change?.duplicated?.from)
    onChange(
      { ...node, props: { ...p, fields: clean }, translations: moveItemTranslations(node.translations, 'fields', change) },
      change?.typing ? { coalesceKey: `${node.id}:fields:${change.typing}` } : undefined,
    )
  }
  const setOptions = (fieldId: string, options: FormFieldOption[], change?: ItemListChange) => {
    const fields = p.fields.map((f) => (f.id === fieldId ? { ...f, options } : f))
    onChange(
      { ...node, props: { ...p, fields }, translations: moveItemTranslations(node.translations, `fields.${fieldId}.options`, change) },
      change?.typing ? { coalesceKey: `${node.id}:fields:${fieldId}:options:${change.typing}` } : undefined,
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <TextField label="Title" hint="Optional." value={p.title} max={T.title} error={errors.title} onChange={(title) => patch(node, onChange, { title }, 'title')} />
      <TextField label="Text" multiline hint="Optional: a line about what happens next." value={p.text} max={T.text} error={errors.text} onChange={(text) => patch(node, onChange, { text }, 'text')} />

      <ItemList<FormFieldValue>
        label="Fields"
        noun="field"
        items={p.fields}
        min={B8B_LIMITS.formFields.min}
        max={B8B_LIMITS.formFields.max}
        errors={errors}
        errorPrefix="fields"
        create={(id) => formFieldDefaults(id, 'text', 'New question')}
        summary={(field) => `${field.label || KIND_INFO[field.kind].label}${field.required ? ' *' : ''}`}
        lead={(field) => {
          const Icon = KIND_INFO[field.kind]?.icon ?? TypeIcon
          return <Icon role="img" className="size-4 shrink-0 text-muted-foreground" aria-label={KIND_INFO[field.kind]?.label ?? field.kind} />
        }}
        onChange={setFields}
      >
        {(field, i, update) => {
          const e = itemErrors(errors, 'fields', i)
          return (
            <>
              <KindPicker value={field.kind} onChange={(kind) => setFields(p.fields.map((f) => (f.id === field.id ? withKind(f, kind) : f)))} />
              <TextField label="Question" value={field.label} max={T['fields.*.label']} error={e.label} onChange={(label) => update({ label }, 'label')} />
              {hasPlaceholder(field.kind) && (
                <TextField
                  label={field.kind === 'select' ? 'Text before a choice is made' : 'Example inside the box'}
                  hint="Optional, e.g. “017…” for a phone number."
                  value={field.placeholder}
                  max={T['fields.*.placeholder']}
                  error={e.placeholder}
                  onChange={(placeholder) => update({ placeholder }, 'placeholder')}
                />
              )}
              <TextField label="Help text" hint="Optional: shown under the box." value={field.help} max={T['fields.*.help']} error={e.help} onChange={(help) => update({ help }, 'help')} />
              <ToggleField label={field.kind === 'checkbox' ? 'Must be ticked' : 'Must be filled in'} checked={field.required} onChange={(required) => update({ required })} />
              {isChoice(field.kind) && (
                <ItemList<FormFieldOption>
                  label="Choices"
                  noun="choice"
                  items={field.options}
                  min={B8B_LIMITS.formOptions.min}
                  max={B8B_LIMITS.formOptions.max}
                  errors={e}
                  errorPrefix="options"
                  create={(id) => ({ id, label: 'New choice' })}
                  summary={(option) => option.label}
                  onChange={(options, change) => setOptions(field.id, options, change)}
                >
                  {(option, o, updateOption) => (
                    <>
                      <TextField label="Choice" value={option.label} max={T['fields.*.options.*.label']} error={itemErrors(e, 'options', o).label} onChange={(label) => updateOption({ label }, 'label')} />
                      <ItemBangla {...props} list={`fields.${field.id}.options`} itemId={option.id} fields={[{ name: 'label', label: 'Choice', base: option.label }]} />
                    </>
                  )}
                </ItemList>
              )}
              {field.kind === 'number' && (
                <div className="grid grid-cols-2 gap-2">
                  <OptionalNumber label="Smallest" hint="Empty = no limit." value={field.min} error={e.min} onChange={(min) => update({ min })} />
                  <OptionalNumber label="Largest" hint="Empty = no limit." value={field.max} error={e.max} onChange={(max) => update({ max })} />
                </div>
              )}
              {(field.kind === 'text' || field.kind === 'textarea') && (
                <OptionalNumber
                  label="Longest answer (characters)"
                  integer
                  hint={`Optional, ${B8B_LIMITS.formMaxLength.min}–${B8B_LIMITS.formMaxLength.max}. Empty = ${field.kind === 'text' ? 255 : 2000}.`}
                  value={field.max_length}
                  error={e.max_length}
                  onChange={(max_length) => update({ max_length })}
                />
              )}
              {field.kind === 'email' && (
                <ToggleField
                  label="Reply to this address"
                  hint="When you answer the e-mail notice, your reply goes to the shopper. Only one e-mail field can do this."
                  checked={field.reply_to}
                  onChange={(reply_to) => setFields(p.fields.map((f) => (f.id === field.id ? { ...f, reply_to } : reply_to ? { ...f, reply_to: false } : f)))}
                />
              )}
              <FieldError message={e.reply_to ?? e.options ?? e.kind} />
              <ItemBangla
                {...props}
                list="fields"
                itemId={field.id}
                fields={[
                  { name: 'label', label: 'Question', base: field.label },
                  ...(hasPlaceholder(field.kind) ? [{ name: 'placeholder', label: 'Example inside the box', base: field.placeholder }] : []),
                  { name: 'help', label: 'Help text', base: field.help },
                ]}
              />
            </>
          )
        }}
      </ItemList>

      <TextField label="Button text" value={p.submit_label} max={T.submit_label} error={errors.submit_label} onChange={(submit_label) => patch(node, onChange, { submit_label }, 'submit_label')} />
      <TextField
        label="Thank-you message"
        multiline
        hint="Shown after the form is sent."
        value={p.success_message}
        max={T.success_message}
        error={errors.success_message}
        onChange={(success_message) => patch(node, onChange, { success_message }, 'success_message')}
      />

      <div className="flex flex-col gap-3 rounded-md border p-3">
        <ToggleField
          label="Ask the shopper to agree first"
          hint="Adds an “I agree” box that must be ticked, e.g. to your privacy policy."
          checked={p.consent !== null}
          onChange={(on) => patch(node, onChange, { consent: on ? { text: 'I agree that my answers are stored to reply to me.', link: { url: '/pages/privacy-policy' } } : null })}
        />
        {p.consent !== null && (
          <>
            <TextField label="What they agree to" multiline value={p.consent.text} max={T['consent.text']} error={errors['consent.text']} onChange={(text) => patch(node, onChange, { consent: { ...p.consent!, text } }, 'consent.text')} />
            <LinkField
              label="Link to read more"
              hint="Optional, e.g. your privacy policy page."
              value={p.consent.link?.url ?? null}
              error={errors['consent.link']}
              onChange={(url) => patch(node, onChange, { consent: { ...p.consent!, link: url === null ? null : { url } } }, 'consent.link')}
            />
          </>
        )}
      </div>

      <NotifyEmail node={node} onChange={onChange} error={errors.notify_email} />

      <ChoiceField
        label="Layout"
        value={p.layout}
        error={errors.layout}
        options={[
          { value: 'stacked', label: 'One under another' },
          { value: 'two_columns', label: 'Two side by side (wide screens)' },
        ]}
        onChange={(layout) => patch(node, onChange, { layout })}
      />
      <Note>Shoppers can’t upload files with a form (for safety). The form works on your live store; here in the builder it can’t be sent.</Note>
      <Bangla
        {...props}
        fields={[
          { name: 'title', label: 'Title', base: p.title },
          { name: 'text', label: 'Text', base: p.text, kind: 'textarea' },
          { name: 'submit_label', label: 'Button text', base: p.submit_label },
          { name: 'success_message', label: 'Thank-you message', base: p.success_message, kind: 'textarea' },
          ...(p.consent ? [{ name: 'consent.text', label: 'What they agree to', base: p.consent.text, kind: 'textarea' as const }] : []),
        ]}
      />
    </div>
  )
}

/** The B8b form for a node, or null for other types. */
export function B8bForm(props: B8bFormProps<Element>) {
  if (props.node.type === 'form') return <FormElementForm {...(props as unknown as B8bFormProps<FormElement>)} />
  return null
}
