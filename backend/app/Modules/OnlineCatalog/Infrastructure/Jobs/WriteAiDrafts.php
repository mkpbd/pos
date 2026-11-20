<?php

namespace App\Modules\OnlineCatalog\Infrastructure\Jobs;

use App\Modules\OnlineCatalog\Application\Ai\RunAiDraftBatch;
use App\Modules\OnlineCatalog\Infrastructure\Models\AiContentBatch;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;

/**
 * AI2a: writes the drafts of one AI drafts batch in the batch's organization (no request, so the
 * tenant is set here). Not retried: a failure of one subject is recorded on its draft, and a
 * batch that stops half way can simply be started again for what is still missing.
 */
class WriteAiDrafts implements ShouldQueue
{
    use Queueable;

    public int $tries = 1;

    /** Up to 200 sequential model calls. */
    public int $timeout = 3600;

    public function __construct(public readonly string $batchId) {}

    public function handle(TenantContext $tenant): void
    {
        $batch = AiContentBatch::query()->withoutGlobalScope('organization')->find($this->batchId);
        if ($batch === null || $batch->status !== 'queued') {
            return;
        }

        // Resolved inside the tenant: the catalog read model caches per instance and organization.
        $tenant->runAs($batch->organization_id, fn () => app(RunAiDraftBatch::class)($batch));
    }
}
