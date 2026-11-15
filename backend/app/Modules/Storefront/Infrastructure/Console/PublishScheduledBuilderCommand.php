<?php

namespace App\Modules\Storefront\Infrastructure\Console;

use App\Modules\Organizations\Application\Contracts\OrganizationDirectory;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Storefront\Application\Builder\Publishing\BuilderPublishSchedules;
use App\Modules\Storefront\Infrastructure\Models\BuilderSchedule;
use Illuminate\Console\Command;
use Throwable;

/**
 * B11: every minute — publishes the store builder pages and theme drafts whose "publish later"
 * time has come (BuilderPublishSchedules::runDue: each claimed under a row lock, so parallel runs
 * publish it once). Suspended organizations wait; an unexpected error is reported and the
 * schedule stays pending for the next run.
 */
class PublishScheduledBuilderCommand extends Command
{
    protected $signature = 'storefront:publish-scheduled';

    protected $description = 'Publish store builder pages and themes scheduled for now or earlier';

    public function handle(BuilderPublishSchedules $schedules, TenantContext $tenant, OrganizationDirectory $organizations): int
    {
        $due = BuilderSchedule::query()->withoutGlobalScope('organization')
            ->where('status', BuilderSchedule::PENDING)
            ->where('publish_at', '<=', now())
            ->orderBy('publish_at')
            ->limit(200)
            ->get(['id', 'organization_id']);

        $active = [];
        $published = 0;
        foreach ($due as $schedule) {
            if (! ($active[$schedule->organization_id] ??= $organizations->isActive($schedule->organization_id))) {
                continue;
            }
            try {
                $published += $tenant->runAs($schedule->organization_id, fn () => $schedules->runDue($schedule->id)) ? 1 : 0;
            } catch (Throwable $e) {
                report($e);
            }
        }

        $this->info("Ran {$published} due schedule(s).");

        return self::SUCCESS;
    }
}
