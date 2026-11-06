<?php

namespace App\Modules\Reports\Presentation\Http\Controllers;

use App\Modules\Reports\Application\Dashboard\Dashboard;
use App\Modules\Shared\Application\Contracts\TenantUser;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use Illuminate\Contracts\Auth\Access\Authorizable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class DashboardController
{
    /**
     * Dashboard
     *
     * `branch_id`, `date_from`, `date_to` (organization dates; default the last 30 days up to
     * today; at most 366 days). KPIs (total sales, today's revenue, orders, gross profit —
     * null without `products.view_cost`, average ticket, returns) each with the previous
     * period, the daily sales trend (POS vs online), top 10 products, low stock (count + 10),
     * the 10 latest transactions, sales by channel and by branch (null for a single branch).
     * Cached for 60 seconds per organization and branch scope.
     */
    public function __invoke(Request $request, Dashboard $dashboard): JsonResponse
    {
        /** @var TenantUser&Authorizable $user */
        $user = $request->user();
        $payload = $dashboard->build($user, $request->only(['branch_id', 'date_from', 'date_to']));

        return ApiResponse::success($payload['data'], meta: $payload['meta']);
    }
}
