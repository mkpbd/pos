import { useId, useState } from 'react'
import { RulerIcon, XIcon } from 'lucide-react'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { useLocale } from '../i18n/locale'
import type { SizeGuide } from '../types'

/** P1a: "Size guide" — opens the guide in a dialog; focus returns to the button on close. */
export function SizeGuideButton({ guide }: { guide: SizeGuide }) {
  const { t } = useLocale()
  const [open, setOpen] = useState(false)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="inline-flex min-h-11 items-center gap-2 self-start rounded-sf-button text-sm font-semibold text-sf-link underline underline-offset-4 hover:no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sf-accent"
          data-testid="size-guide-button"
        >
          <RulerIcon aria-hidden className="size-4" />
          {t('catalog.sizeGuide.open')}
        </button>
      </DialogTrigger>
      <SizeGuideDialog guide={guide} />
    </Dialog>
  )
}

/**
 * The guide: title, intro, an optional picture, the measurements as a real table (scrolls sideways
 * on phones with the first column kept in view; the scroll area takes keyboard focus) and a note.
 */
function SizeGuideDialog({ guide }: { guide: SizeGuide }) {
  const { t } = useLocale()
  const captionId = useId()
  const [first, ...rest] = guide.columns

  return (
    <DialogContent
      showCloseButton={false}
      className="max-h-[92dvh] w-full gap-4 overflow-y-auto bg-sf-surface p-5 text-sf-text sm:max-w-2xl md:p-6"
      data-testid="size-guide"
      {...(guide.intro ? {} : { 'aria-describedby': undefined })}
    >
      <div className="flex items-start justify-between gap-4">
        <DialogTitle className="font-heading text-2xl leading-tight font-extrabold text-sf-heading">{guide.title}</DialogTitle>
        <DialogClose
          aria-label={t('common.close')}
          className="-mt-1 -mr-1 grid size-11 shrink-0 place-items-center rounded-full text-sf-heading hover:bg-sf-canvas focus-visible:outline-2 focus-visible:outline-sf-accent"
        >
          <XIcon aria-hidden className="size-5" />
        </DialogClose>
      </div>
      {guide.intro && <DialogDescription className="text-base leading-relaxed whitespace-pre-line text-sf-text">{guide.intro}</DialogDescription>}
      {guide.image && (
        <img
          src={guide.image.url}
          srcSet={guide.image.srcset || undefined}
          sizes="(min-width: 672px) 624px, 100vw"
          width={guide.image.width}
          height={guide.image.height}
          alt={guide.image.alt ?? ''}
          loading="lazy"
          decoding="async"
          className="h-auto max-h-72 w-full rounded-lg object-contain"
        />
      )}
      {first && (
        <div role="region" aria-labelledby={captionId} tabIndex={0} className="overflow-x-auto rounded-lg border border-sf-border focus-visible:outline-2 focus-visible:outline-sf-accent">
          <table className="w-full border-collapse text-sm">
            <caption id={captionId} className="sr-only">
              {guide.title}
            </caption>
            <thead>
              <tr className="bg-sf-canvas">
                <th scope="col" className="sticky left-0 z-10 bg-sf-canvas px-3 py-2.5 text-left font-semibold whitespace-nowrap text-sf-heading">
                  {first.label}
                </th>
                {rest.map((column) => (
                  <th key={column.id} scope="col" className="px-3 py-2.5 text-left font-semibold whitespace-nowrap text-sf-heading">
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {guide.rows.map((row) => (
                <tr key={row.id} className="border-t border-sf-border">
                  <th scope="row" className="sticky left-0 z-10 bg-sf-surface px-3 py-2.5 text-left font-semibold whitespace-nowrap text-sf-heading">
                    {row.cells[first.id] ?? ''}
                  </th>
                  {rest.map((column) => (
                    <td key={column.id} className="px-3 py-2.5 whitespace-nowrap">
                      {row.cells[column.id] ?? ''}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {guide.note && <p className="text-sm leading-relaxed whitespace-pre-line">{guide.note}</p>}
    </DialogContent>
  )
}
