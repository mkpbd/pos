import { Link } from 'react-router'
import { Loader2Icon, RocketIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { GlobalStylesPanel } from '@/features/storefront/theme/global-styles'
import type { SiteStyles, SiteStylesStatus } from './use-site-styles'

/*
 * The Site styles drawer of the store builder (B3): the global styles panel on the theme draft
 * (state in ./use-site-styles.ts), with its save status and "Publish site styles".
 */

const STATUS_TEXT: Record<SiteStylesStatus, string> = { idle: 'Changes show on the page at once.', saving: 'Saving…', saved: 'Saved to the draft.', error: '' }

/** The Site styles drawer (non-modal, so the page stays visible and the preview updates beside it). */
export function SiteStylesDrawer({ open, onOpenChange, styles, canPublish }: { open: boolean; onOpenChange: (open: boolean) => void; styles: SiteStyles; canPublish: boolean }) {
  const { settings, draft } = styles
  const unpublished = draft?.has_unpublished_changes === true || settings !== (draft?.settings ?? null)
  return (
    <Sheet open={open} onOpenChange={onOpenChange} modal={false}>
      <SheetContent
        side="right"
        className="w-[26rem] gap-0 p-0 sm:max-w-[26rem]"
        data-testid="site-styles-drawer"
        onInteractOutside={(event) => event.preventDefault()}
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <SheetHeader className="border-b pr-12">
          <SheetTitle>Site styles</SheetTitle>
          <SheetDescription>Colours, fonts, text sizes and buttons for the whole store. Visitors see them after you publish.</SheetDescription>
          <p className="mt-1 text-xs text-muted-foreground" role="status" data-testid="site-styles-status">
            {styles.status === 'saving' && <Loader2Icon className="mr-1 inline size-3 animate-spin" aria-hidden />}
            {styles.status === 'error' ? <span className="text-destructive">{styles.message}</span> : STATUS_TEXT[styles.status]}
            {draft?.published ? ` Live: version ${draft.published.number}.` : draft ? ' Not published yet.' : ''}
          </p>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {styles.loading ? (
            <p className="text-sm text-muted-foreground">Loading the site styles…</p>
          ) : styles.loadError || !settings ? (
            <p className="text-sm text-destructive">The site styles couldn’t be loaded. Try again later, or use the Theme page.</p>
          ) : (
            <GlobalStylesPanel settings={settings} onChange={styles.change} errors={styles.errors} variant="drawer" />
          )}
        </div>
        <div className="flex flex-col gap-2 border-t p-4">
          {canPublish ? (
            <Button type="button" onClick={() => void styles.publish()} disabled={!settings || styles.publishing || !unpublished}>
              {styles.publishing ? <Loader2Icon className="animate-spin" data-icon="inline-start" /> : <RocketIcon data-icon="inline-start" />}
              {unpublished ? 'Publish site styles' : 'Site styles are live'}
            </Button>
          ) : (
            <p className="text-xs text-muted-foreground">Someone with permission to publish makes these changes live.</p>
          )}
          <p className="text-xs text-muted-foreground">
            Logo, announcement, footer and layouts are on the <Link to="/admin/storefront/theme" className="underline underline-offset-2">Theme page</Link>.
          </p>
        </div>
      </SheetContent>
    </Sheet>
  )
}
