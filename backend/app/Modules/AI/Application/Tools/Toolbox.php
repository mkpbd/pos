<?php

namespace App\Modules\AI\Application\Tools;

use App\Modules\AI\Application\Insights\InsightsCalculator;
use App\Modules\Inventory\Application\Services\StoreAccess;
use App\Modules\Purchasing\Application\Queries\ReorderSuggestions;
use App\Modules\Reports\Application\Dashboard\Dashboard;
use App\Modules\Reports\Application\ReportRegistry;
use App\Modules\Reports\Application\ReportRunner;
use App\Modules\Reports\Domain\ReportDefinition;
use App\Modules\Shared\Application\Contracts\TenantUser;
use Illuminate\Contracts\Auth\Access\Authorizable;

/**
 * The tools one user's question may use — the only data the model can reach:
 *
 * - one tool per registry report the user may run (ReportRegistry::visibleTo: no P&L / tax
 *   without reports.financial);
 * - reorder_suggestions and shortage_risk with purchases.view;
 * - dashboard_kpis with dashboard.view;
 * - sales_anomalies and slow_movers with reports.view.
 *
 * Every tool is read-only and bound to the user (tenant, branches, cost visibility).
 */
final class Toolbox
{
    public function __construct(
        private readonly ReportRegistry $registry,
        private readonly ReportRunner $runner,
        private readonly ReorderSuggestions $suggestions,
        private readonly StoreAccess $stores,
        private readonly Dashboard $dashboard,
        private readonly InsightsCalculator $calculator,
    ) {}

    /**
     * @return array<string, AiTool> keyed by tool name
     */
    public function forUser(TenantUser&Authorizable $user, string $organizationId, string $today): array
    {
        $limit = max(1, min(ReportRunner::MAX_PER_PAGE, (int) config('ai.tool_row_limit', 50)));
        $tools = [];
        foreach ($this->registry->visibleTo($user) as $definition) {
            /** @var ReportDefinition $definition */
            $report = $this->registry->find($definition->key);
            if ($report !== null) {
                $tools[$definition->key] = new ReportTool($report, $this->runner, $user, $limit);
            }
        }
        if ($user->can('dashboard.view')) {
            $tools[DashboardKpisTool::NAME] = new DashboardKpisTool($this->dashboard, $user);
        }
        if ($user->can('purchases.view')) {
            $tools[ReorderSuggestionsTool::NAME] = new ReorderSuggestionsTool($this->suggestions, $this->stores, $user, $organizationId, $limit);
        }
        foreach (AnalyticsTool::PERMISSIONS as $name => $permission) {
            if ($user->can($permission)) {
                $tools[$name] = new AnalyticsTool($name, $this->calculator, $user, $today, $limit);
            }
        }

        return $tools;
    }
}
