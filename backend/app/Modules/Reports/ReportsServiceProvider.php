<?php

namespace App\Modules\Reports;

use App\Modules\Reports\Application\ReportRegistry;
use App\Modules\Shared\Infrastructure\Providers\ModuleServiceProvider;

/**
 * Reports and the dashboard (Phase 7): read models only. The registry of whitelisted reports
 * (`GET /reports`, `GET /reports/{key}` with X1 exports) — the definitions Phase 8's natural
 * language reporting will call — and `GET /dashboard`. Reports read other modules' tables
 * read-only (the documented read-model exception), always scoped by organization and branch.
 */
class ReportsServiceProvider extends ModuleServiceProvider
{
    public function register(): void
    {
        $this->app->singleton(ReportRegistry::class);
    }

    protected function permissions(): array
    {
        return [
            'reports.view' => 'Run operational reports (sales, inventory, purchasing, customers, payments, expenses) for accessible branches; cost and profit columns also need products.view_cost',
            'reports.financial' => 'Run financial reports (profit and loss, tax)',
            'dashboard.view' => 'View the dashboard (sales KPIs, trend, top products, low stock, recent transactions) for accessible branches',
        ];
    }
}
