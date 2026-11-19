<?php

namespace App\Modules\Marketing\Infrastructure\Console;

use Carbon\CarbonImmutable;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * B15: page insights are kept 90 days — deletes older daily counts (pages, sections, click
 * grids, Web Vitals) and the visitor hashes of days before yesterday (they only count a day's
 * unique visitors; their daily salt is gone by then). Scheduled daily.
 */
class PrunePageInsightsCommand extends Command
{
    public const KEEP_DAYS = 90;

    protected $signature = 'marketing:prune-page-insights';

    protected $description = 'Delete page insights older than 90 days and old page visitor hashes';

    public function handle(): int
    {
        // Days are organization-local; counting from UTC keeps at least 90 local days everywhere.
        $today = CarbonImmutable::now('UTC');
        $cutoff = $today->subDays(self::KEEP_DAYS)->toDateString();
        $deleted = 0;
        foreach (['builder_page_stats', 'builder_section_stats', 'builder_click_cells', 'builder_vital_buckets'] as $table) {
            $deleted += DB::table($table)->where('day', '<', $cutoff)->delete();
        }
        $hashes = DB::table('builder_visitor_hashes')->where('day', '<', $today->subDays(2)->toDateString())->delete();
        $this->info("Deleted {$deleted} page insight rows and {$hashes} visitor hashes.");

        return self::SUCCESS;
    }
}
