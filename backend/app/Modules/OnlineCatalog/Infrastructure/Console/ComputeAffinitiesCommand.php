<?php

namespace App\Modules\OnlineCatalog\Infrastructure\Console;

use App\Modules\OnlineCatalog\Infrastructure\ReadModels\ProductAffinityProjection;
use App\Modules\Organizations\Application\Contracts\OrganizationDirectory;
use Carbon\CarbonImmutable;
use Illuminate\Console\Command;
use Illuminate\Support\Str;
use Throwable;

/**
 * P1b: "frequently bought together" scores from the last 180 days of web orders and POS sales.
 * Run by hand it computes at once (every active organization, or `--organization`). The scheduler
 * runs it hourly with `--nightly`: an organization is then handled from 03:00 in its own timezone,
 * once per local day (product_affinity_runs), like `ai:daily-insights`. One organization failing
 * is reported and never stops the others.
 */
class ComputeAffinitiesCommand extends Command
{
    public const LOCAL_TIME = '03:00';

    protected $signature = 'pos:affinities:compute
        {--organization= : Only this organization id}
        {--nightly : Scheduled run: once per organization and local day, from 03:00 local time}';

    protected $description = 'Compute "frequently bought together" scores from the last 180 days of web orders and POS sales';

    public function handle(OrganizationDirectory $organizations, ProductAffinityProjection $projection): int
    {
        $only = $this->option('organization');
        if (is_string($only) && $only !== '' && ! Str::isUuid($only)) {
            $this->error('The organization must be an organization id (uuid).');

            return self::FAILURE;
        }
        $ids = is_string($only) && $only !== '' ? [strtolower($only)] : $organizations->activeIds();

        $computed = 0;
        $skipped = 0;
        foreach ($ids as $organizationId) {
            $timezone = $organizations->summary($organizationId)['timezone'] ?? null;
            $local = CarbonImmutable::now(is_string($timezone) && $timezone !== '' ? $timezone : (string) config('app.timezone'));
            if ($this->option('nightly') && ($local->format('H:i') < self::LOCAL_TIME || $projection->ranOn($organizationId, $local->toDateString()))) {
                $skipped++;

                continue;
            }
            try {
                $pairs = $projection->rebuild($organizationId, $local->toDateString());
                $computed++;
                if ($this->output->isVerbose()) {
                    $this->line("{$organizationId}: {$pairs} pair(s).");
                }
            } catch (Throwable $e) {
                report($e);
                $this->warn("Skipping {$organizationId}: {$e->getMessage()}");
            }
        }

        $this->info("Product affinities computed for {$computed} organization(s); {$skipped} not due.");

        return self::SUCCESS;
    }
}
