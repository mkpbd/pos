<?php

namespace App\Modules\Purchasing\Infrastructure\Console;

use App\Modules\Branches\Application\Contracts\BranchDirectory;
use App\Modules\Organizations\Application\Contracts\OrganizationDirectory;
use App\Modules\Purchasing\Application\Queries\ReorderSuggestions;
use App\Modules\Purchasing\Infrastructure\Models\ReorderNotificationRun;
use App\Modules\Purchasing\Infrastructure\Notifications\ReorderNeededNotification;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Users\Application\Contracts\UserDirectory;
use Carbon\CarbonImmutable;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Str;
use Throwable;

/**
 * Daily reorder alert (SC1). Scheduled hourly; an organization is handled from 07:00 in its
 * own timezone. Each active store with suggestions gets one in-app notification per local
 * day for the users who hold `purchases.manage` in its branch. The day's run is claimed
 * first (unique store + day), so overlapping or repeated runs never notify twice.
 */
class SendReorderNotificationsCommand extends Command
{
    public const LOCAL_HOUR = 7;

    protected $signature = 'purchasing:reorder-notifications {--any-hour : Ignore the 07:00 local start (manual runs)}';

    protected $description = 'Notify purchasing staff about stores with items that need reordering (once a day per store)';

    public function handle(
        OrganizationDirectory $organizations,
        BranchDirectory $branches,
        UserDirectory $users,
        ReorderSuggestions $suggestions,
        TenantContext $tenant,
    ): int {
        $sent = 0;
        foreach ($organizations->activeIds() as $organizationId) {
            $timezone = $organizations->summary($organizationId)['timezone'] ?? null;
            $local = CarbonImmutable::now(is_string($timezone) && $timezone !== '' ? $timezone : (string) config('app.timezone'));
            if ($local->hour < self::LOCAL_HOUR && ! $this->option('any-hour')) {
                continue;
            }
            $day = $local->toDateString();

            foreach ($branches->activeStores($organizationId) as $store) {
                try {
                    $sent += $tenant->runAs($organizationId, fn () => $this->notifyStore($organizationId, $store, $day, $users, $suggestions)) ? 1 : 0;
                } catch (Throwable $e) {
                    report($e);
                }
            }
        }

        $this->info("Sent {$sent} reorder notification(s).");

        return self::SUCCESS;
    }

    /**
     * @param  array{id: string, code: string, name: string, branch_id: string, branch_name: string}  $store
     */
    private function notifyStore(string $organizationId, array $store, string $day, UserDirectory $users, ReorderSuggestions $suggestions): bool
    {
        if (ReorderNotificationRun::query()->where('store_id', $store['id'])->where('run_on', $day)->exists()) {
            return false;
        }
        $items = count($suggestions->forStore($organizationId, $store['id'])['rows']);
        if ($items === 0) {
            return false;
        }
        $recipients = $users->withPermissionInBranch($organizationId, 'purchases.manage', $store['branch_id']);

        $claimed = ReorderNotificationRun::query()->insertOrIgnore([
            'id' => (string) Str::uuid7(),
            'organization_id' => $organizationId,
            'store_id' => $store['id'],
            'run_on' => $day,
            'items' => $items,
            'recipients' => $recipients->count(),
            'created_at' => now(),
        ]) === 1;
        if (! $claimed || $recipients->isEmpty()) {
            return false;
        }

        Notification::send($recipients, new ReorderNeededNotification([
            'title' => 'Reorder needed: '.$store['name'],
            'message' => sprintf('%d %s need%s reordering at %s.', $items, $items === 1 ? 'item' : 'items', $items === 1 ? 's' : '', $store['name']),
            'store_id' => $store['id'],
            'branch_id' => $store['branch_id'],
            'items' => $items,
            'date' => $day,
            'link' => '/purchasing/reorder?store_id='.$store['id'],
        ]));

        return true;
    }
}
