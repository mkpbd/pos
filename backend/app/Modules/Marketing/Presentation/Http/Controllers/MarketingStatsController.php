<?php

namespace App\Modules\Marketing\Presentation\Http\Controllers;

use App\Modules\Marketing\Application\Queries\CampaignStats;
use App\Modules\Marketing\Infrastructure\Models\Campaign;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;

/**
 * P2a: campaign performance (Marketing → Campaigns dashboard).
 */
class MarketingStatsController
{
    /**
     * Campaign stats
     *
     * `?from=YYYY-MM-DD&to=YYYY-MM-DD` (calendar days in the organization's time zone; default
     * the last 30 days, at most 366) `&campaign_id=` (one campaign). → `{range: {from, to,
     * timezone}, currency, campaign: {id, name}|null, totals, by_campaign (null campaign =
     * "Direct / other"; empty for one campaign), by_source, by_day, top_landing_pages}`; each
     * figure set `{visits, unique_visitors, orders, cancelled_orders, items, revenue,
     * conversion_rate, average_order_value}` (subsets per list). Revenue leaves out cancelled
     * and failed orders.
     */
    public function __invoke(Request $request, CampaignStats $stats): JsonResponse
    {
        $data = $request->validate([
            'from' => ['sometimes', 'date_format:Y-m-d'],
            'to' => ['sometimes', 'date_format:Y-m-d'],
            'campaign_id' => ['sometimes', 'uuid'],
        ]);
        $today = $stats->today()['today'];
        $to = $data['to'] ?? $today;
        $from = $data['from'] ?? CarbonImmutable::parse($to)->subDays(CampaignStats::DEFAULT_DAYS - 1)->toDateString();
        if ($from > $to) {
            throw ValidationException::withMessages(['to' => ['The end date must not be before the start date.']]);
        }
        if (CarbonImmutable::parse($from)->diffInDays(CarbonImmutable::parse($to)) + 1 > CampaignStats::MAX_DAYS) {
            throw ValidationException::withMessages(['from' => ['Choose at most '.CampaignStats::MAX_DAYS.' days.']]);
        }
        $campaign = isset($data['campaign_id']) ? Campaign::query()->findOrFail(strtolower($data['campaign_id'])) : null;

        return ApiResponse::success($stats($from, $to, $campaign));
    }
}
