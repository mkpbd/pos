<?php

namespace App\Modules\Cart\Infrastructure\Console;

use App\Modules\Cart\Application\Services\CartReminders;
use App\Modules\Organizations\Application\Contracts\OrganizationDirectory;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use Illuminate\Console\Command;
use Throwable;

/**
 * BD2b: abandoned-cart reminders (CartReminders) for every active organization with
 * `cart_reminders` on. Scheduled hourly; each cart is reminded at most once.
 */
class SendCartRemindersCommand extends Command
{
    protected $signature = 'cart:reminders';

    protected $description = 'Remind signed-in shoppers of the carts they left (e-mail, else SMS)';

    public function handle(OrganizationDirectory $organizations, TenantContext $tenant, CartReminders $reminders): int
    {
        $sent = 0;
        foreach ($organizations->activeIds() as $organizationId) {
            try {
                $sent += $tenant->runAs($organizationId, fn () => $reminders->send());
            } catch (Throwable $e) {
                report($e);
            }
        }

        $this->info("Sent {$sent} cart reminder(s).");

        return self::SUCCESS;
    }
}
