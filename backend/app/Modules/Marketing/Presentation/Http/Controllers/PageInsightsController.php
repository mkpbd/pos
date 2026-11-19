<?php

namespace App\Modules\Marketing\Presentation\Http\Controllers;

use App\Modules\Marketing\Application\Queries\ExperimentResults;
use App\Modules\Marketing\Application\Queries\PageInsights;
use App\Modules\Shared\Domain\CampaignAttribution;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * B15: store builder page insights for the editor and the Pages list.
 */
class PageInsightsController
{
    /**
     * Page insights
     *
     * `?from=YYYY-MM-DD&to=YYYY-MM-DD` (calendar days in the organization's time zone; default
     * the last 30 days, at most 365) `&device=desktop|tablet|mobile` (default all). → `{document,
     * from, to, device, timezone, currency, totals: {views, unique_visitors, avg_scroll, clicks,
     * orders, revenue, conversion, scroll_reach, vitals: {lcp_p75, cls_p75, inp_p75, rating,
     * samples}}, daily, sections, heat, versions}`. Rates are percentages (strings, 2 decimals).
     */
    public function show(Request $request, string $document, PageInsights $insights): JsonResponse
    {
        [$from, $to] = $this->range($request, $insights);
        $device = $request->validate(['device' => ['sometimes', 'nullable', 'string', Rule::in(CampaignAttribution::DEVICES)]])['device'] ?? null;

        $result = $insights->document($document, $from, $to, $device);

        return $result === null
            ? ApiResponse::error('NOT_FOUND', 'The requested resource was not found.', 404)
            : ApiResponse::success($result);
    }

    /**
     * A/B test results
     *
     * B13: `?device=desktop|tablet|mobile` (default all) → `{experiment, document_id, from, to,
     * device, timezone, currency, goal, arms: {A|B: {visitors, views, goal_count, rate, orders,
     * revenue, add_to_carts, clicks, section_views}}, lift, probability_b_beats_a, confidence:
     * low|medium|high, enough_data, recommendation: keep_a|keep_b|keep_running, daily: [{day, A:
     * {visitors, goal_count}, B: …}]}` from the day the test started to the day it ended (else
     * today). 404 NOT_FOUND (not a page of this store), 404 EXPERIMENT_NOT_FOUND.
     */
    public function experiment(Request $request, string $document, string $experiment, ExperimentResults $results): JsonResponse
    {
        $device = $request->validate(['device' => ['sometimes', 'nullable', 'string', Rule::in(CampaignAttribution::DEVICES)]])['device'] ?? null;
        $result = $results->results($document, $experiment, $device);

        return match ($result) {
            'NOT_FOUND' => ApiResponse::error('NOT_FOUND', 'The requested resource was not found.', 404),
            'EXPERIMENT_NOT_FOUND' => ApiResponse::error('EXPERIMENT_NOT_FOUND', 'This A/B test does not exist on this page.', 404),
            default => ApiResponse::success($result),
        };
    }

    /**
     * Page insights summary
     *
     * `?from=&to=` as above → `{from, to, timezone, currency, documents: [{document_id, views,
     * unique_visitors, orders, revenue, conversion}]}` for the pages with views or orders.
     */
    public function index(Request $request, PageInsights $insights): JsonResponse
    {
        [$from, $to] = $this->range($request, $insights);

        return ApiResponse::success($insights->summary($from, $to));
    }

    /**
     * @return array{0: string, 1: string}
     */
    private function range(Request $request, PageInsights $insights): array
    {
        $data = $request->validate([
            'from' => ['sometimes', 'date_format:Y-m-d'],
            'to' => ['sometimes', 'date_format:Y-m-d'],
        ]);
        $to = $data['to'] ?? $insights->today()['today'];
        $from = $data['from'] ?? CarbonImmutable::parse($to)->subDays(PageInsights::DEFAULT_DAYS - 1)->toDateString();
        if ($from > $to) {
            throw ValidationException::withMessages(['to' => ['The end date must not be before the start date.']]);
        }
        if (CarbonImmutable::parse($from)->diffInDays(CarbonImmutable::parse($to)) + 1 > PageInsights::MAX_DAYS) {
            throw ValidationException::withMessages(['from' => ['Choose at most '.PageInsights::MAX_DAYS.' days.']]);
        }

        return [$from, $to];
    }
}
