import type { ReactNode } from 'react'
import { StoreIcon } from 'lucide-react'
import { ThemeToggle } from '@/components/common/theme-toggle'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'

export function AuthLayout({ title, description, children, footer }: { title: string; description?: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col bg-canvas">
      <header className="flex items-center justify-between bg-topbar p-4 text-topbar-foreground [&_[data-slot=button]:hover]:bg-topbar-accent [&_[data-slot=button]:hover]:text-white [&_[data-slot=button][aria-expanded=true]]:bg-topbar-accent">
        <div className="flex items-center gap-2 font-heading font-bold tracking-wide text-white dark:text-heading">
          <StoreIcon className="size-5" aria-hidden />
          Enterprise POS
        </div>
        <ThemeToggle />
      </header>
      <main className="flex flex-1 items-start justify-center px-4 pt-8 pb-16 sm:pt-16">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="tracking-normal normal-case">
              <h1 className="font-heading text-xl">{title}</h1>
            </CardTitle>
            {description && <CardDescription>{description}</CardDescription>}
          </CardHeader>
          <CardContent>{children}</CardContent>
          {footer && <CardFooter className="justify-center text-sm text-muted-foreground">{footer}</CardFooter>}
        </Card>
      </main>
    </div>
  )
}
