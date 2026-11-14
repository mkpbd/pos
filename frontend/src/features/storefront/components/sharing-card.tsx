import { useId, useState, type FormEvent } from 'react'
import { ExternalLinkIcon, Loader2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { useSaveStorefrontSettingsMutation, type StorefrontSettings } from '@/features/storefront/api'
import { cleanPhone, whatsappDigits, whatsappNumberProblem } from '@/features/storefront/whatsapp'
import { fieldErrorMap } from '@/lib/forms'

type Toggle = 'share_buttons' | 'whatsapp_order_button' | 'whatsapp_chat_button'

/**
 * P2b "Sharing & WhatsApp": share buttons on store pages, the shop's WhatsApp number, the
 * "Order on WhatsApp" button and the floating chat button. Render with `key` = the saved number.
 */
export function SharingCard({ settings, canManage }: { settings: StorefrontSettings; canManage: boolean }) {
  const id = useId()
  const save = useSaveStorefrontSettingsMutation()
  const saved = settings.whatsapp_number ?? null
  const [number, setNumber] = useState(saved ? `+${saved}` : '')
  const [error, setError] = useState<string | null>(null)
  const [toggleError, setToggleError] = useState<string | null>(null)
  const busy = !canManage || save.isPending
  const dirty = whatsappDigits(number) !== (saved ?? '')

  const values: Record<Toggle, boolean> = {
    share_buttons: settings.share_buttons ?? true,
    whatsapp_order_button: settings.whatsapp_order_button ?? true,
    whatsapp_chat_button: settings.whatsapp_chat_button ?? true,
  }

  const toggle = (field: Toggle, on: boolean, done: string) => {
    setToggleError(null)
    save.mutate({ [field]: on }, { onSuccess: () => toast.success(done), onError: (e) => setToggleError(fieldErrorMap(e)[field] ?? fieldErrorMap(e).form ?? e.message) })
  }

  const saveNumber = (e: FormEvent) => {
    e.preventDefault()
    const problem = whatsappNumberProblem(number)
    setError(problem)
    if (problem) return
    const value = cleanPhone(number)
    save.mutate(
      { whatsapp_number: value === '' ? null : value },
      {
        onSuccess: (s) => toast.success(s.whatsapp_number ? `WhatsApp number saved: +${s.whatsapp_number}.` : 'WhatsApp number removed. The WhatsApp buttons are hidden.'),
        onError: (err) => {
          const map = fieldErrorMap(err)
          setError(map.whatsapp_number ?? map.form ?? err.message)
        },
      },
    )
  }

  const needsNumber = saved ? undefined : 'Shown once a WhatsApp number is saved.'

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sharing & WhatsApp</CardTitle>
        <CardDescription>Let shoppers share your products and reach you on WhatsApp.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <Switch
              id={`${id}-share`}
              checked={values.share_buttons}
              disabled={busy}
              aria-describedby={`${id}-share-help`}
              onCheckedChange={(on) => toggle('share_buttons', on, on ? 'Share buttons are shown.' : 'Share buttons are hidden.')}
            />
            <Label htmlFor={`${id}-share`}>Show share buttons</Label>
          </div>
          <p id={`${id}-share-help`} className="text-sm text-muted-foreground">
            Facebook, Messenger, WhatsApp, X, Pinterest and “Copy link” on product pages, campaign pages and blog posts. On phones, the phone’s own share menu opens.
          </p>
        </div>

        <form onSubmit={saveNumber} noValidate className="flex flex-col gap-1.5">
          <Label htmlFor={`${id}-number`}>WhatsApp number</Label>
          <div className="flex flex-wrap items-start gap-2">
            <Input
              id={`${id}-number`}
              type="tel"
              inputMode="tel"
              autoComplete="off"
              className="w-full sm:w-64"
              placeholder="01712345678"
              value={number}
              disabled={!canManage}
              aria-invalid={error ? true : undefined}
              aria-describedby={`${id}-number-help`}
              onChange={(e) => {
                setNumber(e.target.value)
                if (error) setError(null)
              }}
            />
            {canManage && (
              <Button type="submit" variant="outline" disabled={save.isPending || !dirty}>
                {save.isPending && dirty && <Loader2Icon data-icon="inline-start" className="animate-spin" />}
                Save number
              </Button>
            )}
          </div>
          <p id={`${id}-number-help`} className={error ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'}>
            {error ?? 'The number your shop answers WhatsApp on, e.g. 01712345678 or +8801712345678. Leave empty to hide the WhatsApp buttons.'}
          </p>
          {saved && (
            <a href={`https://wa.me/${saved}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 self-start text-sm text-primary underline-offset-4 hover:underline">
              Try the chat link (wa.me/{saved}) <ExternalLinkIcon className="size-3.5" aria-hidden />
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          )}
        </form>

        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <Switch
              id={`${id}-order`}
              checked={values.whatsapp_order_button}
              disabled={busy}
              aria-describedby={`${id}-order-help`}
              onCheckedChange={(on) => toggle('whatsapp_order_button', on, on ? 'Product pages show “Order on WhatsApp”.' : '“Order on WhatsApp” is hidden.')}
            />
            <Label htmlFor={`${id}-order`}>“Order on WhatsApp” button on product pages</Label>
          </div>
          <p id={`${id}-order-help`} className="text-sm text-muted-foreground">
            Next to Buy now. It opens WhatsApp with a ready message: the product, the chosen size or colour, quantity, price and link. {needsNumber}
          </p>
        </div>

        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <Switch
              id={`${id}-chat`}
              checked={values.whatsapp_chat_button}
              disabled={busy}
              aria-describedby={`${id}-chat-help`}
              onCheckedChange={(on) => toggle('whatsapp_chat_button', on, on ? 'The WhatsApp chat button is shown on every page.' : 'The WhatsApp chat button is hidden.')}
            />
            <Label htmlFor={`${id}-chat`}>Floating WhatsApp chat button</Label>
          </div>
          <p id={`${id}-chat-help`} className="text-sm text-muted-foreground">A round button in the bottom corner of every store page. {needsNumber}</p>
        </div>
        {toggleError && <p role="alert" className="text-sm text-destructive">{toggleError}</p>}
      </CardContent>
    </Card>
  )
}
