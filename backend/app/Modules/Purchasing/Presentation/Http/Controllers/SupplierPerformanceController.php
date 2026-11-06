<?php

namespace App\Modules\Purchasing\Presentation\Http\Controllers;

use App\Modules\Organizations\Application\Support\OrganizationDate;
use App\Modules\Purchasing\Application\Queries\SupplierPerformance;
use App\Modules\Purchasing\Presentation\Http\Exports\SupplierPerformanceExport;
use App\Modules\Shared\Application\Contracts\TenantUser;
use App\Modules\Shared\Infrastructure\Http\Exports\ListExporter;
use App\Modules\Shared\Infrastructure\Http\Exports\RowSource;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpFoundation\Response;

/**
 * Supplier performance (SC3): a read model over purchase orders, receipts, returns, landed
 * costs and RFQs. Dates are the organization's; the default range is the last 90 days.
 */
class SupplierPerformanceController
{
    public const SORTS = ['score', 'name', 'orders', 'spend', 'on_time_rate', 'fill_rate', 'avg_lead_days', 'return_rate', 'price_change_pct', 'quote_response_rate', 'quotes_won'];

    public function __construct(
        private readonly SupplierPerformance $performance,
        private readonly OrganizationDate $dates,
    ) {}

    /**
     * Supplier performance
     *
     * Filters: `date_from`, `date_to` (default: the last 90 days up to today), `branch_id`,
     * `supplier_id`. Sort: `score` (default `-score`), `name`, `orders`, `spend`,
     * `on_time_rate`, `fill_rate`, `avg_lead_days`, `return_rate`, `price_change_pct`,
     * `quote_response_rate`, `quotes_won`; empty metrics sort last.
     */
    public function index(Request $request, ListExporter $exports): Response
    {
        $this->validate($request, withSort: true);
        $period = $this->performance->period($request->query('date_from'), $request->query('date_to'));
        $rows = $this->performance->list($this->user($request), $period, $request->query('branch_id'), $request->query('supplier_id'), (string) $request->query('sort', '-score'));

        if ($format = ListExporter::requested($request)) {
            return $exports->download($request, $format, SupplierPerformanceExport::class, RowSource::fromRows($rows));
        }

        return ApiResponse::success($rows, meta: ['period' => $period]);
    }

    /**
     * Performance of one supplier
     *
     * The same metrics for one supplier, a monthly trend of the 12 months up to `date_to`
     * (orders, on-time rate, fill rate, spend) and its most recent late or short deliveries.
     */
    public function show(Request $request, string $supplierId): JsonResponse
    {
        $this->validate($request, withSort: false);
        $period = $this->performance->period($request->query('date_from'), $request->query('date_to'));

        return ApiResponse::success($this->performance->detail($this->user($request), $supplierId, $period, $request->query('branch_id')));
    }

    private function validate(Request $request, bool $withSort): void
    {
        $request->validate([
            'date_to' => ['sometimes', 'date_format:Y-m-d'],
            'branch_id' => ['sometimes', 'uuid'],
            'supplier_id' => ['sometimes', 'uuid'],
            ...($withSort ? ['sort' => ['sometimes', Rule::in([...self::SORTS, ...array_map(fn (string $s) => '-'.$s, self::SORTS)])]] : []),
        ]);
        $to = (string) ($request->query('date_to') ?? $this->dates->today());
        $request->validate(['date_from' => ['sometimes', 'date_format:Y-m-d', 'before_or_equal:'.$to]]);
        if ($request->filled('date_from') && (strtotime($to) - strtotime((string) $request->query('date_from'))) / 86400 > 3660) {
            throw ValidationException::withMessages(['date_from' => ['Choose a range of at most ten years.']]);
        }
    }

    private function user(Request $request): TenantUser
    {
        /** @var TenantUser */
        return $request->user();
    }
}
