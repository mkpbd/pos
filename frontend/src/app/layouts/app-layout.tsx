import { useState } from 'react'
import { NavLink, Outlet } from 'react-router'
import { MenuIcon, StoreIcon } from 'lucide-react'
import { ThemeToggle } from '@/components/common/theme-toggle'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { BranchSwitcher } from '@/app/layouts/branch-switcher'
import { UserMenu } from '@/app/layouts/user-menu'
import { NotificationBell } from '@/features/notifications/notification-bell'
import { visibleNavItems } from '@/app/navigation'
import { useAuth } from '@/features/auth/use-auth'
import { cn } from '@/lib/utils'

function Brand({ subtitle }: { subtitle?: string }) {
  return (
    <div className="flex items-center gap-2 px-2">
      <StoreIcon className="size-5 shrink-0 text-primary" aria-hidden />
      <div className="flex min-w-0 flex-col leading-tight">
        <span className="font-heading text-base font-semibold">Enterprise POS</span>
        {subtitle && <span className="truncate text-xs text-muted-foreground">{subtitle}</span>}
      </div>
    </div>
  )
}

function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const me = useAuth()

  return (
    <nav aria-label="Main" className="flex flex-col gap-1">
      {visibleNavItems(me).map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent hover:text-accent-foreground',
              isActive ? 'bg-accent font-medium text-accent-foreground' : 'text-muted-foreground',
            )
          }
        >
          <Icon className="size-4" aria-hidden />
          {label}
        </NavLink>
      ))}
    </nav>
  )
}

export function AppLayout() {
  const me = useAuth()
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <div className="flex min-h-svh bg-background text-foreground">
      <aside className="hidden w-60 shrink-0 flex-col gap-6 border-r bg-sidebar p-4 md:flex">
        <Brand subtitle={me.organization?.name} />
        <SidebarNav />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex h-14 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur">
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="md:hidden" aria-label="Open navigation">
                <MenuIcon />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-64 p-4">
              <SheetHeader className="p-0">
                <SheetTitle asChild>
                  <div>
                    <Brand subtitle={me.organization?.name} />
                  </div>
                </SheetTitle>
              </SheetHeader>
              <SidebarNav onNavigate={() => setMobileOpen(false)} />
            </SheetContent>
          </Sheet>
          <div className="hidden sm:block md:hidden">
            <Brand />
          </div>
          <div className="ml-auto flex min-w-0 items-center gap-1">
            <BranchSwitcher />
            <NotificationBell />
            <ThemeToggle />
            <UserMenu />
          </div>
        </header>

        <main className="flex-1 p-4 md:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
