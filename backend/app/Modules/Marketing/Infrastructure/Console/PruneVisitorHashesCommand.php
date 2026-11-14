<?php

namespace App\Modules\Marketing\Infrastructure\Console;

use Carbon\CarbonImmutable;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * P2a: deletes the visitor hashes of days before yesterday (they only serve to count a day's
 * unique visitors; their daily salt is gone by then).
 */
class PruneVisitorHashesCommand extends Command
{
    protected $signature = 'marketing:prune-visitor-hashes';

    protected $description = 'Delete campaign visitor hashes older than yesterday';

    public function handle(): int
    {
        // Days are organization-local; two days back is safe for every time zone.
        $deleted = DB::table('campaign_visitor_hashes')->where('day', '<', CarbonImmutable::now('UTC')->subDays(2)->toDateString())->delete();
        $this->info("Deleted {$deleted} visitor hashes.");

        return self::SUCCESS;
    }
}
