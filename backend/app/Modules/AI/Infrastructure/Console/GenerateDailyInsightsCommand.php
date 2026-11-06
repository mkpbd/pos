<?php

namespace App\Modules\AI\Infrastructure\Console;

use App\Modules\AI\Application\Insights\BusinessInsights;
use App\Modules\AI\Infrastructure\Models\AiInsight;
use App\Modules\Branches\Application\Contracts\BranchDirectory;
use App\Modules\Organizations\Application\Contracts\OrganizationDirectory;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use Carbon\CarbonImmutable;
use Illuminate\Console\Command;
use Throwable;

/**
 * Daily business insights (Phase 8). Scheduled every 30 minutes; an organization is handled from 07:30 in
 * its own timezone: yesterday's daily insight (facts with cost figures + narrative when AI is on)
 * is cached in `ai_insights` for the whole organization and for each active branch. Idempotent:
 * a scope whose row exists is skipped, and a row is unique per organization × scope × day, so
 * repeated or overlapping runs never compute (or spend tokens) twice. Facts are stored even when
 * AI is off; the narrative is then written on the first read after AI is turned on.
 */
class GenerateDailyInsightsCommand extends Command
{
    public const LOCAL_TIME = '07:30';

    protected $signature = 'ai:daily-insights {--any-hour : Ignore the 07:30 local start (manual runs)} {--date= : The day to summarize (Y-m-d, default yesterday)}';

    protected $description = 'Cache yesterday\'s business insights per organization and branch (once a day)';

    public function handle(OrganizationDirectory $organizations, BranchDirectory $branches, BusinessInsights $insights, TenantContext $tenant): int
    {
        $generated = 0;
        $skipped = 0;
        foreach ($organizations->activeIds() as $organizationId) {
            $timezone = $organizations->summary($organizationId)['timezone'] ?? null;
            $local = CarbonImmutable::now(is_string($timezone) && $timezone !== '' ? $timezone : (string) config('app.timezone'));
            if ($local->format('H:i') < self::LOCAL_TIME && ! $this->option('any-hour')) {
                continue;
            }
            $today = $local->toDateString();
            $day = is_string($this->option('date')) && $this->option('date') !== '' ? (string) $this->option('date') : $local->subDay()->toDateString();
            if ($day >= $today) {
                $this->warn("Skipping {$organizationId}: {$day} is not a closed day yet.");

                continue;
            }

            $scopes = [null];
            foreach ($branches->summaries($organizationId) as $branch) {
                if ($branch['is_active']) {
                    $scopes[] = $branch['id'];
                }
            }
            foreach ($scopes as $branchId) {
                try {
                    $created = $tenant->runAs($organizationId, function () use ($insights, $organizationId, $branchId, $day, $today) {
                        $exists = AiInsight::query()->withoutGlobalScope('organization')
                            ->where('organization_id', $organizationId)->where('scope_key', $branchId ?? 'all')
                            ->where('period', 'daily')->whereDate('period_date', $day)->where('with_cost', true)->exists();
                        if ($exists) {
                            return false;
                        }
                        $insights->cached($organizationId, $branchId, 'daily', $day, true, $today, null, 'daily_insights');

                        return true;
                    }, $branchId);
                    $created ? $generated++ : $skipped++;
                } catch (Throwable $e) {
                    report($e);
                }
            }
        }

        $this->info("Generated {$generated} daily insight(s); {$skipped} already cached.");

        return self::SUCCESS;
    }
}
