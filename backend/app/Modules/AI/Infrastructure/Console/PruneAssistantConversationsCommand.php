<?php

namespace App\Modules\AI\Infrastructure\Console;

use App\Modules\AI\Infrastructure\Models\AssistantConversation;
use Illuminate\Console\Command;

/**
 * AI2b: shopper assistant conversations (and their messages) are kept for 30 days after their
 * last message. Scheduled daily (routes/console.php).
 */
class PruneAssistantConversationsCommand extends Command
{
    public const RETENTION_DAYS = 30;

    protected $signature = 'storefront:prune-assistant';

    protected $description = 'Delete online store assistant conversations older than 30 days';

    public function handle(): int
    {
        $deleted = 0;
        AssistantConversation::query()->withoutGlobalScopes()
            ->where('last_message_at', '<', now()->subDays(self::RETENTION_DAYS))
            ->select('id')
            ->chunkById(500, function ($rows) use (&$deleted) {
                // Messages go with their conversation (ON DELETE CASCADE).
                $deleted += AssistantConversation::query()->withoutGlobalScopes()->whereIn('id', $rows->pluck('id'))->delete();
            });

        $this->info("Deleted {$deleted} assistant conversation(s).");

        return self::SUCCESS;
    }
}
