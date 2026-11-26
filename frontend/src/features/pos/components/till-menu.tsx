import { useState } from 'react'
import { MonitorCogIcon, PrinterIcon, VaultIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { useCan } from '@/features/auth/use-auth'
import { OpenDrawerDialog } from '@/features/pos/components/open-drawer-dialog'
import { PrinterSetupDialog } from '@/features/pos/printing/printer-setup-dialog'

/**
 * POS1d: the till menu — this device's receipt printer, and opening the cash drawer without a sale
 * (needs the cashier's open register session in this branch).
 */
export function TillMenu({ storeId, sessionReady, shop }: { storeId: string | null; sessionReady: boolean; shop: string | null }) {
  const can = useCan()
  const [action, setAction] = useState<'printer' | 'drawer' | null>(null)
  const canOpenDrawer = can('pos.sell') && can('cash_registers.operate')

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="outline">
            <MonitorCogIcon data-icon="inline-start" /> Till
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setAction('printer')}>
            <PrinterIcon /> Receipt printer
          </DropdownMenuItem>
          {canOpenDrawer && (
            <DropdownMenuItem disabled={!sessionReady} onSelect={() => setAction('drawer')}>
              <VaultIcon />
              <span className="flex flex-col">
                Open drawer
                {!sessionReady && <span className="text-xs text-muted-foreground">Open a register session first</span>}
              </span>
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <PrinterSetupDialog open={action === 'printer'} onOpenChange={(o) => { if (!o) setAction(null) }} shop={shop} />
      {action === 'drawer' && <OpenDrawerDialog storeId={storeId} onClose={() => setAction(null)} />}
    </>
  )
}
