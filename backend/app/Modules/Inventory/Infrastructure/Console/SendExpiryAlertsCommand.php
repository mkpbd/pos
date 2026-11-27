<?php

namespace App\Modules\Inventory\Infrastructure\Console;

use App\Modules\Branches\Application\Contracts\BranchDirectory;
use App\Modules\Inventory\Infrastructure\Models\StockLevel;
use App\Modules\Inventory\Infrastructure\Notifications\ExpiryAlertNotification;
use App\Modules\Organizations\Application\Contracts\OrganizationDirectory;
use App\Modules\Products\Application\Contracts\ProductDirectory;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Infrastructure\Persistence\AlertRun;
use App\Modules\Users\Application\Contracts\UserDirectory;
use Carbon\CarbonImmutable;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Notification;
use Throwable;

/**
 * R1: daily batch-expiry alert. Scheduled hourly; an organization is handled from 08:00 in its
 * own timezone unless `alerts.expiry_alert_days` is 0. Each active store holding batches with
 * stock that expire within that many days (or have expired) gets one in-app notification per
 * local day (claim `expiry_alert` per store) for the users with `inventory.view` in its branch:
 * the count and the first five batches by expiry date.
 */
class SendExpiryAlertsCommand extends Command
{
    public const LOCAL_HOUR = 8;

    public const LISTED = 5;

    protected $signature = 'inventory:expiry-alerts {--any-hour : Ignore the 08:00 local start (manual runs)}';

    protected $description = 'Notify stock staff about batches that expire soon (once a day per store)';

    public function handle(
        OrganizationDirectory $organizations,
        BranchDirectory $branches,
        UserDirectory $users,
        ProductDirectory $products,
        TenantContext $tenant,
    ): int {
        $sent = 0;
        foreach ($organizations->activeIds() as $organizationId) {
            $days = $organizations->alertSettings($organizationId)['expiry_alert_days'];
            $timezone = $organizations->summary($organizationId)['timezone'] ?? null;
            $local = CarbonImmutable::now(is_string($timezone) && $timezone !== '' ? $timezone : (string) config('app.timezone'));
            if ($days <= 0 || ($local->hour < self::LOCAL_HOUR && ! $this->option('any-hour'))) {
                continue;
            }

            foreach ($branches->activeStores($organizationId) as $store) {
                try {
                    $sent += $tenant->runAs($organizationId, fn () => $this->notifyStore($organizationId, $store, $local, $days, $users, $products)) ? 1 : 0;
                } catch (Throwable $e) {
                    report($e);
                }
            }
        }

        $this->info("Sent {$sent} expiry alert(s).");

        return self::SUCCESS;
    }

    /**
     * @param  array{id: string, code: string, name: string, branch_id: string, branch_name: string}  $store
     */
    private function notifyStore(string $organizationId, array $store, CarbonImmutable $local, int $days, UserDirectory $users, ProductDirectory $products): bool
    {
        $day = $local->toDateString();
        if (AlertRun::claimed('expiry_alert', $store['id'], $day)) {
            return false;
        }
        $query = StockLevel::query()
            ->join('batches as b', 'b.id', '=', 'stock_levels.batch_id')
            ->where('stock_levels.store_id', $store['id'])
            ->where('stock_levels.quantity', '>', 0)
            ->whereNotNull('b.expires_on')
            ->where('b.expires_on', '<=', $local->addDays($days)->toDateString());
        $count = (clone $query)->count();
        if ($count === 0) {
            return false;
        }
        $expired = (clone $query)->where('b.expires_on', '<', $day)->count();
        $first = $query->orderBy('b.expires_on')->orderBy('b.batch_number')->limit(self::LISTED)
            ->get(['stock_levels.variant_id', 'b.batch_number', 'b.expires_on', 'stock_levels.quantity']);
        $variants = $products->variants($organizationId, $first->pluck('variant_id')->unique()->values()->all());
        $recipients = $users->withPermissionInBranch($organizationId, 'inventory.view', $store['branch_id']);

        if (! AlertRun::claim($organizationId, 'expiry_alert', $store['id'], $day) || $recipients->isEmpty()) {
            return false;
        }

        Notification::send($recipients, new ExpiryAlertNotification([
            'title' => 'Expiring stock: '.$store['name'],
            'message' => sprintf('%d %s at %s %s expired or expire%s within %d days.', $count, $count === 1 ? 'batch' : 'batches', $store['name'],
                $count === 1 ? 'has' : 'have', $count === 1 ? 's' : '', $days),
            'store_id' => $store['id'],
            'branch_id' => $store['branch_id'],
            'count' => $count,
            'expired' => $expired,
            'days' => $days,
            'items' => $first->map(function ($row) use ($variants) {
                $variant = $variants[$row->variant_id] ?? null;

                return [
                    'variant_id' => $row->variant_id,
                    'product' => $variant === null ? 'Unknown product'
                        : $variant['product_name'].(filled($variant['variant_name']) ? ' — '.$variant['variant_name'] : ''),
                    'batch' => $row->batch_number,
                    'expires_on' => substr((string) $row->expires_on, 0, 10),
                    'quantity' => (string) $row->quantity,
                ];
            })->all(),
            'date' => $day,
            'link' => '/reports/expiry?store_id='.$store['id'],
        ]));

        return true;
    }
}
