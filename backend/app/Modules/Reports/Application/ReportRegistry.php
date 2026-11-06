<?php

namespace App\Modules\Reports\Application;

use App\Modules\Reports\Application\Contracts\Report;
use App\Modules\Reports\Domain\ReportDefinition;
use App\Modules\Reports\Domain\ReportGroup;
use Illuminate\Contracts\Auth\Access\Authorizable;
use Illuminate\Contracts\Container\Container;

/**
 * The whitelist of reports (Phase 7) — the backbone of the reports page and, in Phase 8, of
 * natural-language reporting: a question maps to one of these keys and typed parameters, and
 * the Reports module runs it in the caller's scope. Nothing outside this list can run.
 */
final class ReportRegistry
{
    /** @var list<class-string<Report>> */
    public const REPORTS = [
        Reports\SalesDailyReport::class,
        Reports\SalesMonthlyReport::class,
        Reports\SalesByProductReport::class,
        Reports\SalesByCategoryReport::class,
        Reports\SalesByBranchReport::class,
        Reports\SalesByCashierReport::class,
        Reports\ProfitAndLossReport::class,
        Reports\InventoryValuationReport::class,
        Reports\StockMovementsReport::class,
        Reports\LowStockReport::class,
        Reports\ExpiryReport::class,
        Reports\PurchasesReport::class,
        Reports\CustomerDuesReport::class,
        Reports\SupplierDuesReport::class,
        Reports\PaymentCollectionsReport::class,
        Reports\TaxReport::class,
        Reports\ExpensesReport::class,
    ];

    /** @var array<string, Report>|null */
    private ?array $reports = null;

    public function __construct(private readonly Container $container) {}

    /**
     * @return array<string, Report> keyed by report key, in catalog order
     */
    public function all(): array
    {
        if ($this->reports === null) {
            $this->reports = [];
            foreach (self::REPORTS as $class) {
                $report = $this->container->make($class);
                $this->reports[$report->definition()->key] = $report;
            }
        }

        return $this->reports;
    }

    public function find(string $key): ?Report
    {
        return $this->all()[$key] ?? null;
    }

    /**
     * Reports the user may run, in catalog order.
     *
     * @return list<ReportDefinition>
     */
    public function visibleTo(Authorizable $user): array
    {
        return array_values(array_filter(
            array_map(fn (Report $r) => $r->definition(), $this->all()),
            fn (ReportDefinition $d) => $user->can($d->permission),
        ));
    }

    /**
     * @return list<array{key: string, label: string}>
     */
    public static function groups(): array
    {
        return array_map(fn (ReportGroup $g) => ['key' => $g->value, 'label' => $g->label()], ReportGroup::cases());
    }
}
