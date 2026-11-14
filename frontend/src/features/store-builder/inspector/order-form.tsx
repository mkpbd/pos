/*
 * P2a: the Content tab of the one-product order form (`order_form`). The product it sells, whether
 * shoppers choose its option (size, colour …), the starting and largest quantity, the e-mail and
 * note fields, how they pay, the texts (title, text, button, thank-you message), an optional add-on
 * product with its tick-box text, and the layout. Name, phone and address are always asked. Every
 * text has its Bangla field. The setup dialog (insert) asks only for the product and the payment.
 */

import { useState } from 'react'
import { ImageIcon, XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ProductSearchAdder } from '@/features/online-catalog/components/ordered-picker'
import { useProductNames } from '@/features/products/api'
import type { Element, OrderFormElement, OrderFormProps } from '@/storefront/builder/types'
import { ORDER_FORM_LIMITS, ORDER_FORM_TEXT_LIMITS } from '@/storefront/builder/validate'
import { FieldError } from './fields'
import { Bangla, Note, NumberField } from './form-kit'
import { patch, type ElementFormProps } from './form-model'
import { ChoiceField, ManageLink, SingleProductPicker, TextField, ToggleField } from './pickers'

const T = ORDER_FORM_TEXT_LIMITS
const Q = ORDER_FORM_LIMITS

/** The add-on's tick-box text when one is turned on. */
export const UPSELL_LABEL = 'Yes, add this to my order'

const PAYMENT_OPTIONS = [
  { value: 'cod_only', label: 'Cash on delivery only' },
  { value: 'store_methods', label: 'All payment methods of your store' },
] as const satisfies readonly { value: OrderFormProps['payment']; label: string }[]

const EMAIL_OPTIONS = [
  { value: 'hidden', label: 'Don’t ask' },
  { value: 'optional', label: 'Ask, may be left empty' },
  { value: 'required', label: 'Ask, must be filled in' },
] as const satisfies readonly { value: OrderFormProps['fields']['email']; label: string }[]

const NOTE_OPTIONS = [
  { value: 'hidden', label: 'Don’t ask' },
  { value: 'optional', label: 'Ask, may be left empty' },
] as const satisfies readonly { value: OrderFormProps['fields']['note']; label: string }[]

function PaymentField({ node, onChange, errors }: ElementFormProps<OrderFormElement>) {
  return (
    <ChoiceField
      label="How shoppers pay"
      value={node.props.payment}
      error={errors.payment}
      hint={node.props.payment === 'cod_only' ? 'Most landing page orders are paid in cash when the parcel arrives.' : 'Shoppers choose from the payment methods your checkout offers.'}
      options={PAYMENT_OPTIONS}
      onChange={(payment) => patch(node, onChange, { payment })}
    />
  )
}

/**
 * The optional add-on: a switch, then the product (stored only once one is chosen, so a half-done
 * add-on never stops the draft from saving) and the tick-box text.
 */
function UpsellField(props: ElementFormProps<OrderFormElement>) {
  const { node, onChange, errors } = props
  const upsell = node.props.upsell
  const [asking, setAsking] = useState(false)
  const names = useProductNames(upsell ? [upsell.product_id] : [])
  const found = upsell ? names.get(upsell.product_id) : undefined
  const on = upsell !== null || asking
  const exclude = [node.props.product_id, upsell?.product_id].filter((id): id is string => !!id)
  // Without an add-on its Bangla tick-box text goes too.
  const removeUpsell = () => {
    const translations = Object.fromEntries(Object.entries(node.translations).map(([locale, texts]) => [locale, Object.fromEntries(Object.entries(texts).filter(([key]) => key !== 'upsell.label'))]))
    onChange({ ...node, props: { ...node.props, upsell: null }, translations })
  }
  return (
    <div className="flex flex-col gap-3 rounded-md border p-3" data-testid="order-form-upsell">
      <ToggleField
        label="Offer an add-on"
        hint="A tick box for one more product, such as a gift box or a refill. Its price is added when it is ticked."
        checked={on}
        onChange={(next) => {
          setAsking(next)
          if (!next && upsell !== null) removeUpsell()
        }}
      />
      {on && (
        <>
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">Add-on product</span>
            {upsell && (
              <div className="flex items-center gap-3 rounded-md border p-2" data-testid="chosen-upsell">
                <span className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded border bg-muted">
                  {found?.image_url ? <img src={found.image_url} alt="" className="size-full object-cover" /> : <ImageIcon className="size-4 text-muted-foreground" aria-hidden />}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm">{found?.name ?? 'Loading…'}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setAsking(false)
                    removeUpsell()
                  }}
                >
                  <XIcon data-icon="inline-start" /> Remove
                </Button>
              </div>
            )}
            <ProductSearchAdder
              label={upsell ? 'Change add-on' : 'Choose add-on'}
              exclude={exclude}
              onPick={(item) => patch(node, onChange, { upsell: { product_id: item.id, label: upsell?.label ?? UPSELL_LABEL } })}
            />
            <FieldError message={errors['upsell.product_id'] ?? errors.upsell} />
            {!upsell && <p className="text-sm text-muted-foreground">The add-on is saved once you choose its product.</p>}
          </div>
          {upsell && (
            <TextField
              label="Tick-box text"
              hint="Shown next to the box, with the add-on’s name and price."
              value={upsell.label}
              max={T['upsell.label']}
              error={errors['upsell.label']}
              onChange={(label) => patch(node, onChange, { upsell: { ...upsell, label } }, 'upsell.label')}
            />
          )}
        </>
      )}
    </div>
  )
}

export function OrderFormForm(props: ElementFormProps<OrderFormElement>) {
  const { node, onChange, errors, setup } = props
  const p = node.props
  const product = <SingleProductPicker value={p.product_id} error={errors.product_id} onChange={(product_id) => patch(node, onChange, { product_id })} />
  const variants = (
    <ToggleField
      label="Let shoppers choose the option"
      hint="Size, colour and the like. Off: the product’s main option is ordered."
      checked={p.show_variants}
      onChange={(show_variants) => patch(node, onChange, { show_variants })}
    />
  )

  if (setup) {
    return (
      <div className="flex flex-col gap-4">
        {product}
        {variants}
        <PaymentField {...props} />
        <Note>Shoppers order without a cart: they give their name, phone number and address, and confirm. You can change the texts, the quantity, the fields and add an add-on later in the panel on the right.</Note>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {product}
      {variants}
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1.5 text-sm font-medium">Quantity</legend>
        <div className="grid grid-cols-2 gap-2">
          <NumberField
            label="Starts at"
            value={p.quantity.default}
            min={Q.quantityDefault.min}
            max={Q.quantityDefault.max}
            hint={`${Q.quantityDefault.min}–${Q.quantityDefault.max}`}
            error={errors['quantity.default']}
            onChange={(value) => patch(node, onChange, { quantity: { ...p.quantity, default: value } }, 'quantity.default')}
          />
          <NumberField
            label="At most"
            value={p.quantity.max}
            min={Q.quantityMax.min}
            max={Q.quantityMax.max}
            hint={`${Q.quantityMax.min}–${Q.quantityMax.max} per order`}
            error={errors['quantity.max']}
            onChange={(value) => patch(node, onChange, { quantity: { ...p.quantity, max: value } }, 'quantity.max')}
          />
        </div>
      </fieldset>

      <TextField label="Title" hint="Optional." value={p.title} max={T.title} error={errors.title} onChange={(title) => patch(node, onChange, { title }, 'title')} />
      <TextField label="Text" multiline hint="Optional, e.g. “Delivery in 2–3 days all over Bangladesh.”" value={p.text} max={T.text} error={errors.text} onChange={(text) => patch(node, onChange, { text }, 'text')} />

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1.5 text-sm font-medium">What the form asks</legend>
        <Note>Name, mobile number, district, area and full address are always asked.</Note>
        <ChoiceField label="E-mail" value={p.fields.email} error={errors['fields.email']} options={EMAIL_OPTIONS} onChange={(email) => patch(node, onChange, { fields: { ...p.fields, email } })} />
        <ChoiceField label="Note for the order" value={p.fields.note} error={errors['fields.note']} options={NOTE_OPTIONS} onChange={(note) => patch(node, onChange, { fields: { ...p.fields, note } })} />
      </fieldset>

      <PaymentField {...props} />

      <TextField label="Button text" value={p.button_label} max={T.button_label} error={errors.button_label} onChange={(button_label) => patch(node, onChange, { button_label }, 'button_label')} />
      <TextField
        label="Thank-you message"
        multiline
        hint="Shown with the order number after the order is placed."
        value={p.success_message}
        max={T.success_message}
        error={errors.success_message}
        onChange={(success_message) => patch(node, onChange, { success_message }, 'success_message')}
      />

      <UpsellField {...props} />

      <ChoiceField
        label="Layout"
        value={p.layout}
        error={errors.layout}
        options={[
          { value: 'stacked', label: 'One under another' },
          { value: 'two_columns', label: 'Product beside the form (wide screens)' },
        ]}
        onChange={(layout) => patch(node, onChange, { layout })}
      />
      <Note>
        Price, options, stock and offers come from the product; delivery charges from your <ManageLink to="/storefront/shipping">shipping zones</ManageLink>. Orders arrive with your other web orders, marked as coming from this page. Here in the builder the form can’t be sent.
      </Note>
      <Bangla
        {...props}
        fields={[
          { name: 'title', label: 'Title', base: p.title },
          { name: 'text', label: 'Text', base: p.text, kind: 'textarea' },
          { name: 'button_label', label: 'Button text', base: p.button_label },
          { name: 'success_message', label: 'Thank-you message', base: p.success_message, kind: 'textarea' },
          ...(p.upsell ? [{ name: 'upsell.label', label: 'Tick-box text', base: p.upsell.label }] : []),
        ]}
      />
    </div>
  )
}

/** The P2a form for a node, or null for other types. */
export function P2aForm(props: ElementFormProps<Element>) {
  if (props.node.type === 'order_form') return <OrderFormForm {...(props as unknown as ElementFormProps<OrderFormElement>)} />
  return null
}
