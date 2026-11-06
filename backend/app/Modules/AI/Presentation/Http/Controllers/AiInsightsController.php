<?php

namespace App\Modules\AI\Presentation\Http\Controllers;

use App\Modules\AI\Application\Insights\BusinessInsights;
use App\Modules\AI\Application\Insights\CustomerInsights;
use App\Modules\Shared\Application\Contracts\TenantUser;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use Illuminate\Contracts\Auth\Access\Authorizable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * Business and customer insights (Phase 8, `ai.insights`): deterministic facts always, plus a
 * narrative when AI is on (`narrative: null` and `narrative_status` otherwise — never a 503).
 */
class AiInsightsController
{
    public function __construct(private readonly TenantContext $tenant) {}

    /**
     * Business insights
     *
     * `period=daily|monthly` (default daily), `date` (Y-m-d, not in the future; default
     * yesterday for daily, the current month for monthly), `branch_id` (accessible branch).
     * `facts`: KPIs vs the previous period, top movers, anomalies (z-score), margin drop, return
     * spike, slow movers, shortage risk (null without purchases.view); `narrative` | null,
     * `narrative_status` (ok | disabled | unavailable | budget_exceeded | refused | empty),
     * `ai_enabled`, `generated_at`, `cached`.
     */
    public function business(Request $request, BusinessInsights $insights): JsonResponse
    {
        $data = $request->validate([
            'period' => ['sometimes', Rule::in(['daily', 'monthly'])],
            'date' => ['sometimes', 'date_format:Y-m-d'],
            'branch_id' => ['sometimes', 'nullable', 'uuid'],
        ]);

        return ApiResponse::success($insights->forUser(
            $this->user($request),
            $this->tenant->requireOrganization(),
            $data['period'] ?? 'daily',
            $data['branch_id'] ?? null,
            $data['date'] ?? null,
        ));
    }

    /**
     * Customer insights
     *
     * RFM over the last 12 months of POS sales and delivered web orders (`branch_id` optional):
     * `segments` (count, share, averages, top 5 customers masked: name only with customers.view,
     * last 3 phone digits), `suggestions` (loyalty actions by rule), `narrative` | null.
     */
    public function customers(Request $request, CustomerInsights $insights): JsonResponse
    {
        $data = $request->validate(['branch_id' => ['sometimes', 'nullable', 'uuid']]);

        return ApiResponse::success($insights->forUser($this->user($request), $this->tenant->requireOrganization(), $data['branch_id'] ?? null));
    }

    private function user(Request $request): TenantUser&Authorizable
    {
        /** @var TenantUser&Authorizable */
        return $request->user();
    }
}
