import { Link } from 'react-router'
import { UploadIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useCan } from '@/features/auth/use-auth'
import { IMPORT_TYPES, type ImportTypeKey } from '@/features/imports/api'

/** Opens the import wizard for one type; rendered only for users who may run that import. */
export function ImportButton({ type, label, size = 'default' }: { type: ImportTypeKey; label: string; size?: 'default' | 'sm' }) {
  const can = useCan()
  if (!can(IMPORT_TYPES[type].permission)) return null

  return (
    <Button asChild variant="outline" size={size}>
      <Link to={`/imports/new?type=${type}`}><UploadIcon data-icon="inline-start" /> {label}</Link>
    </Button>
  )
}
