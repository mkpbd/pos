import { useId } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const HEX = /^#[0-9a-f]{6}$/i

/** Native colour picker plus the hex value as text (either can be edited). */
export function ColorField({ label, value, onChange, error, disabled }: { label: string; value: string; onChange: (value: string) => void; error?: string; disabled?: boolean }) {
  const id = useId()

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={`${label} picker`}
          value={HEX.test(value) ? value.toLowerCase() : '#000000'}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 w-11 shrink-0 cursor-pointer rounded-md border bg-transparent p-1 disabled:cursor-not-allowed"
        />
        <Input id={id} value={value} disabled={disabled} maxLength={7} spellCheck={false} aria-invalid={error ? true : undefined} onChange={(e) => onChange(e.target.value)} className="font-mono" />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  )
}
