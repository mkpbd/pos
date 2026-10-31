<?php

namespace App\Modules\OnlineCatalog\Infrastructure\Console;

use App\Modules\OnlineCatalog\Infrastructure\Jobs\RefreshProductStats;
use Illuminate\Console\Command;

/**
 * Runs the RefreshProductStats job in this process (scheduled hourly in routes/console.php).
 */
class RefreshProductStatsCommand extends Command
{
    protected $signature = 'storefront:refresh-product-stats {--organization= : Only this organization id}';

    protected $description = 'Rebuild the storefront popularity figures (units sold in 30 days and in total) from completed sales';

    public function handle(): int
    {
        $organization = $this->option('organization');
        $job = new RefreshProductStats(is_string($organization) && $organization !== '' ? $organization : null);
        $count = (int) $this->laravel->call([$job, 'handle']);

        $this->components->info("Product stats refreshed for {$count} organization(s).");

        return self::SUCCESS;
    }
}
