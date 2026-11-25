import { useState } from 'react'
import { Link, Navigate, Outlet, useLocation } from 'react-router'
import { MenuIcon, StoreIcon } from 'lucide-react'
import { ThemeToggle } from '@/components/common/theme-toggle'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { BranchSwitcher } from '@/app/layouts/branch-switcher'
import { UserMenu } from '@/app/layouts/user-menu'
import { NotificationBell } from '@/features/notifications/notification-bell'
import { visibleNavItems } from '@/app/navigation'
import { useTillLockStore } from '@/features/pos/till-lock'
import { useAuth } from '@/features/auth/use-auth'
import { cn } from '@/lib/utils'

function Brand({ subtitle, className }: { subtitle?: string; className?: string }) {
  return (
    <div className={cn('flex min-w-0 items-center gap-2.5', className)}>
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-white/15">
        <StoreIcon className="size-5" aria-hidden />
      </span>
      <div className="flex min-w-0 flex-col leading-tight">
        <span className="font-heading text-base font-bold tracking-wide">Enterprise POS</span>
        {subtitle && <span className="truncate text-xs opacity-80">{subtitle}</span>}
      </div>
    </div>
  )
}

function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const me = useAuth()
  const { pathname } = useLocation()
  const items = visibleNavItems(me)
  const within = (to: string) => pathname === to || pathname.startsWith(`${to}/`)
  // The most specific entry wins: /web-orders/blocked-numbers lights "Blocked numbers", not "Web orders" too.
  const activeTo = items.filter((item) => within(item.to)).sort((a, b) => b.to.length - a.to.length)[0]?.to

  return (
    <nav aria-label="Main" className="flex flex-col gap-0.5 py-3 pr-3">
      {items.map(({ to, label, icon: Icon }) => (
        <Link
          key={to}
          to={to}
          onClick={onNavigate}
          aria-current={to === activeTo ? 'page' : undefined}
          className={cn(
            'group/nav flex items-center gap-1 rounded-md text-xs font-semibold tracking-wide uppercase transition-colors',
            to === activeTo ? 'font-bold text-sidebar-accent-foreground' : 'text-sidebar-foreground hover:text-sidebar-accent-foreground',
          )}
        >
          <span
            className={cn(
              'mx-2.5 flex size-10 shrink-0 items-center justify-center rounded-[5px] transition-colors',
              to === activeTo ? 'bg-sidebar-primary text-sidebar-primary-foreground' : 'group-hover/nav:bg-sidebar-accent',
            )}
          >
            <Icon className="size-5" aria-hidden />
          </span>
          <span className="truncate">{label}</span>
        </Link>
      ))}
    </nav>
  )
}

export function AppLayout() {
  const me = useAuth()
  const [mobileOpen, setMobileOpen] = useState(false)
  const { pathname } = useLocation()
  // POS1a: while this cashier's till is locked, every other page leads back to the lock screen on the POS.
  const tillLocked = useTillLockStore((s) => s.lockedUserId === me.user.id)
  if (tillLocked && pathname !== '/pos') return <Navigate to="/pos" replace />

  return (
    <div className="min-h-svh bg-canvas text-foreground">
      <header className="sticky top-0 z-20 flex h-topbar items-center bg-topbar text-topbar-foreground shadow-card">
        <div className="hidden h-full w-sidebar shrink-0 items-center px-5 text-white md:flex dark:text-heading">
          <Brand subtitle={me.organization?.name} />
        </div>

        <div className="flex min-w-0 flex-1 items-center gap-2 px-3 md:px-6 [&_[data-slot=button]:hover]:bg-topbar-accent [&_[data-slot=button]:hover]:text-white [&_[data-slot=button][aria-expanded=true]]:bg-topbar-accent [&_[data-slot=button][aria-expanded=true]]:text-white">
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="md:hidden" aria-label="Open navigation">
                <MenuIcon />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-64 gap-0 bg-sidebar p-0 [&>[data-slot=sheet-close]]:top-5 [&>[data-slot=sheet-close]]:text-white [&>[data-slot=sheet-close]:hover]:bg-topbar-accent [&>[data-slot=sheet-close]:hover]:text-white dark:[&>[data-slot=sheet-close]]:text-topbar-foreground">
              <SheetHeader className="bg-topbar p-4">
                <SheetTitle asChild className="text-white dark:text-heading">
                  <div>
                    <Brand subtitle={me.organization?.name} />
                  </div>
                </SheetTitle>
              </SheetHeader>
              <SidebarNav onNavigate={() => setMobileOpen(false)} />
            </SheetContent>
          </Sheet>
          <Brand className="hidden text-white sm:flex md:hidden dark:text-heading" />
          <div className="ml-auto flex min-w-0 items-center gap-1">
            <BranchSwitcher />
            <NotificationBell />
            <ThemeToggle />
            <UserMenu />
          </div>
        </div>
      </header>

      <aside className="fixed top-topbar bottom-0 left-0 z-10 hidden w-sidebar overflow-y-auto bg-sidebar shadow-card md:block">
        <SidebarNav />
      </aside>

      <main className="min-w-0 p-4 md:ml-sidebar md:p-6">
        <Outlet />
      </main>
    </div>
  )
}
