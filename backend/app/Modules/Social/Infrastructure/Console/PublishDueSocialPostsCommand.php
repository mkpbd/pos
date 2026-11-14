<?php

namespace App\Modules\Social\Infrastructure\Console;

use App\Modules\Organizations\Application\Contracts\OrganizationDirectory;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Social\Application\Actions\SocialPostWorkflow;
use App\Modules\Social\Domain\PostStatus;
use App\Modules\Social\Infrastructure\Models\SocialPost;
use Illuminate\Console\Command;
use Throwable;

/**
 * P2b: every minute — queues the scheduled posts whose time has come (each claimed under a row
 * lock, so parallel runs publish a post once) and recovers posts a dead worker left
 * `publishing` (SocialPostWorkflow::recoverStale). Suspended organizations wait.
 */
class PublishDueSocialPostsCommand extends Command
{
    protected $signature = 'social:publish-due';

    protected $description = 'Publish scheduled social posts that are due and recover interrupted ones';

    public function handle(SocialPostWorkflow $workflow, TenantContext $tenant, OrganizationDirectory $organizations): int
    {
        $due = SocialPost::query()->withoutGlobalScope('organization')
            ->where('status', PostStatus::Scheduled->value)
            ->where('scheduled_at', '<=', now())
            ->orderBy('scheduled_at')
            ->limit(200)
            ->get(['id', 'organization_id']);

        $stale = SocialPost::query()->withoutGlobalScope('organization')
            ->where('status', PostStatus::Publishing->value)
            ->where('publishing_started_at', '<', now()->subMinutes(SocialPostWorkflow::STALE_MINUTES))
            ->orderBy('publishing_started_at')
            ->limit(200)
            ->get(['id', 'organization_id']);

        $active = [];
        $queued = 0;
        foreach ($due as $post) {
            if (! ($active[$post->organization_id] ??= $organizations->isActive($post->organization_id))) {
                continue;
            }
            try {
                $queued += $tenant->runAs($post->organization_id, fn () => $workflow->publishDue($post->id)) ? 1 : 0;
            } catch (Throwable $e) {
                report($e);
            }
        }
        $recovered = 0;
        foreach ($stale as $post) {
            try {
                $recovered += $tenant->runAs($post->organization_id, fn () => $workflow->recoverStale($post->id));
            } catch (Throwable $e) {
                report($e);
            }
        }

        $this->info("Queued {$queued} due post(s); checked {$recovered} interrupted post(s).");

        return self::SUCCESS;
    }
}
