<?php

namespace App\Modules\OnlineCatalog\Infrastructure\Console;

use App\Modules\OnlineCatalog\Infrastructure\Models\AiContentBatch;
use App\Modules\OnlineCatalog\Infrastructure\Models\AiContentDraft;
use Illuminate\Console\Command;

/**
 * AI2a: AI drafts are kept 30 days — deletes older drafts (whatever their status; approved
 * texts live on the listings) and finished batches older than that with no drafts left.
 * Scheduled daily.
 */
class PruneAiDraftsCommand extends Command
{
    protected $signature = 'online-catalog:prune-ai-drafts';

    protected $description = 'Delete AI drafts of online store texts older than 30 days';

    public function handle(): int
    {
        $before = now()->subDays(AiContentDraft::KEEP_DAYS);

        $drafts = 0;
        AiContentDraft::query()->withoutGlobalScope('organization')
            ->where('created_at', '<', $before)
            ->chunkById(500, function ($rows) use (&$drafts) {
                $drafts += AiContentDraft::query()->withoutGlobalScope('organization')->whereKey($rows->modelKeys())->delete();
            });

        $batches = AiContentBatch::query()->withoutGlobalScope('organization')
            ->where('created_at', '<', $before)
            ->whereNotIn('status', AiContentBatch::ACTIVE)
            ->whereDoesntHave('drafts', fn ($q) => $q->withoutGlobalScope('organization'))
            ->delete();

        $this->info("Deleted {$drafts} AI draft(s) and {$batches} batch(es).");

        return self::SUCCESS;
    }
}
