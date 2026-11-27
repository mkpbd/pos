<?php

namespace App\Modules\Cms\Infrastructure\Jobs;

use App\Modules\Cms\Application\Actions\NewsletterCampaigns;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;

/**
 * BD2b: mails a campaign that is `sending` to the confirmed subscribers. One attempt: a retry
 * could e-mail the first chunks twice.
 */
class SendNewsletterCampaignJob implements ShouldQueue
{
    use Queueable;

    public int $tries = 1;

    public int $timeout = 900;

    public function __construct(
        public readonly string $campaignId,
        public readonly string $organizationId,
    ) {}

    public function handle(TenantContext $tenant, NewsletterCampaigns $campaigns): void
    {
        $tenant->runAs($this->organizationId, fn () => $campaigns->deliver($this->campaignId));
    }
}
