<?php

namespace App\Modules\Social\Infrastructure\Jobs;

use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Social\Application\Actions\PublishSocialPost;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;

/**
 * P2b: publishes a social post's pending targets in the background. One attempt: a target is
 * never posted twice — interrupted targets are failed by the scheduler (PUBLISH_INTERRUPTED) and
 * retried only by the merchant.
 */
class PublishSocialPostJob implements ShouldQueue
{
    use Queueable;

    public int $tries = 1;

    public int $timeout = 300;

    public function __construct(
        public readonly string $postId,
        public readonly string $organizationId,
    ) {}

    public function handle(TenantContext $tenant, PublishSocialPost $publish): void
    {
        $tenant->runAs($this->organizationId, fn () => $publish($this->postId));
    }
}
