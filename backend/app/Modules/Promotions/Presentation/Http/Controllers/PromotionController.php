<?php

namespace App\Modules\Promotions\Presentation\Http\Controllers;

use App\Modules\Promotions\Application\Actions\DeletePromotion;
use App\Modules\Promotions\Application\Actions\SavePromotion;
use App\Modules\Promotions\Application\Queries\PromotionReport;
use App\Modules\Promotions\Domain\PromotionState;
use App\Modules\Promotions\Domain\PromotionTrigger;
use App\Modules\Promotions\Infrastructure\Models\Promotion;
use App\Modules\Promotions\Infrastructure\Models\PromotionRedemption;
use App\Modules\Promotions\Presentation\Http\Exports\PromotionReportExport;
use App\Modules\Promotions\Presentation\Http\Exports\PromotionsExport;
use App\Modules\Promotions\Presentation\Http\Requests\SavePromotionRequest;
use App\Modules\Promotions\Presentation\Http\Support\PromotionPresenter;
use App\Modules\Shared\Infrastructure\Http\Exports\ListExporter;
use App\Modules\Shared\Infrastructure\Http\Exports\RowSource;
use App\Modules\Shared\Infrastructure\Http\Queries\ListQuery;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Support\Collection;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpFoundation\Response;

/**
 * Promotions of the online store (E8b, web only). Viewing needs `promotions.view`, changes
 * `promotions.manage`.
 */
class PromotionController
{
    public function __construct(private readonly PromotionPresenter $presenter) {}

    /**
     * Promotions
     *
     * Filters: `status` (active|scheduled|expired|inactive), `trigger` (automatic|coupon),
     * `search` (name). Newest first (`sort`: created_at, name, starts_at, ends_at).
     * Rows: `{id, name, type, value, scope, trigger, starts_at, ends_at, show_countdown,
     * is_active, state, coupon_count, redemption_count, discount_total}`.
     */
    public function index(Request $request, ListExporter $exports): Response
    {
        $request->validate([
            'status' => ['sometimes', Rule::enum(PromotionState::class)],
            'trigger' => ['sometimes', Rule::enum(PromotionTrigger::class)],
            'search' => ['sometimes', 'nullable', 'string', 'max:100'],
        ]);
        $now = now();
        $query = Promotion::query()->withCount(['coupons', 'redemptions'])->withSum('redemptions', 'amount')
            ->when($request->query('trigger'), fn (Builder $q, string $v) => $q->where('trigger', $v))
            ->when($request->query('status'), fn (Builder $q, string $status) => match (PromotionState::from($status)) {
                PromotionState::Inactive => $q->where('is_active', false),
                PromotionState::Expired => $q->where('is_active', true)->whereNotNull('ends_at')->where('ends_at', '<=', $now),
                PromotionState::Scheduled => $q->where('is_active', true)->where('starts_at', '>', $now)
                    ->where(fn (Builder $w) => $w->whereNull('ends_at')->orWhere('ends_at', '>', $now)),
                PromotionState::Active => $q->where('is_active', true)
                    ->where(fn (Builder $w) => $w->whereNull('starts_at')->orWhere('starts_at', '<=', $now))
                    ->where(fn (Builder $w) => $w->whereNull('ends_at')->orWhere('ends_at', '>', $now)),
            });

        ListQuery::apply($query, $request, sortable: ['created_at', 'name', 'starts_at', 'ends_at'], searchable: ['name'], defaultSort: '-created_at');
        if ($format = ListExporter::requested($request)) {
            return $exports->download($request, $format, PromotionsExport::class, RowSource::fromQuery($query, fn (Collection $promotions) => $promotions->map(fn (Promotion $p) => PromotionPresenter::row($p))));
        }
        $page = $query->paginate(ListQuery::perPage($request));

        return ApiResponse::paginated($page, fn (Promotion $p) => new JsonResource(PromotionPresenter::row($p)));
    }

    /**
     * Promotion
     *
     * The row plus `description, min_subtotal, max_discount, usage_limit,
     * usage_limit_per_customer, targets [{id, name}], coupons_preview` (first 20 codes),
     * `created_at, updated_at`.
     */
    public function show(Promotion $promotion): JsonResponse
    {
        return ApiResponse::success($this->presenter->detail($promotion));
    }

    /**
     * Create a promotion
     *
     * Body: `name, description?, type (percent|fixed|free_shipping), value, scope
     * (order|products|categories|brands), target_ids[], min_subtotal?, max_discount?, trigger
     * (automatic|coupon), starts_at?, ends_at?, show_countdown?, is_active?, usage_limit?,
     * usage_limit_per_customer?` and, for coupon promotions, an optional first `coupon_code`.
     * Combination errors are field errors (VALIDATION_FAILED).
     */
    public function store(SavePromotionRequest $request, SavePromotion $save): JsonResponse
    {
        return ApiResponse::created($this->presenter->detail($save(new Promotion, $request->promotionData())));
    }

    /**
     * Change a promotion
     *
     * Any subset of the fields; `target_ids` replaces the targets.
     */
    public function update(SavePromotionRequest $request, Promotion $promotion, SavePromotion $save): JsonResponse
    {
        return ApiResponse::success($this->presenter->detail($save($promotion, $request->promotionData())));
    }

    /**
     * Delete a promotion
     *
     * Only when no order used it (`IN_USE` otherwise: deactivate it instead).
     */
    public function destroy(Promotion $promotion, DeletePromotion $delete): JsonResponse
    {
        $delete($promotion);

        return ApiResponse::noContent();
    }

    /**
     * Promotion report
     *
     * `?date_from=&date_to=` (Y-m-d, optional, calendar days in the organization's timezone;
     * at most 366 days when both are given). `{date_from, date_to, timezone, currency,
     * redemptions, orders, cancelled_orders, discount_total, order_revenue (sum of those
     * orders' totals), average_discount (per redemption), by_day: [{date, redemptions,
     * discount}]}` — with both dates every day of the range is listed, otherwise only days
     * with redemptions. Redemptions of orders cancelled later stay counted.
     */
    public function report(Request $request, Promotion $promotion, PromotionReport $report, ListExporter $exports, PromotionReportExport $export): Response
    {
        $data = $request->validate([
            'date_from' => ['sometimes', 'nullable', 'date_format:Y-m-d'],
            'date_to' => ['sometimes', 'nullable', 'date_format:Y-m-d', 'after_or_equal:date_from'],
        ]);
        $from = $data['date_from'] ?? null;
        $to = $data['date_to'] ?? null;
        if ($from !== null && $to !== null && CarbonImmutable::parse($from)->diffInDays(CarbonImmutable::parse($to)) >= PromotionReport::MAX_DAYS) {
            throw ValidationException::withMessages(['date_to' => ['Choose at most '.PromotionReport::MAX_DAYS.' days.']]);
        }

        $result = $report->for($promotion, $from, $to);
        if ($format = ListExporter::requested($request)) {
            return $exports->download($request, $format, $export, RowSource::fromRows($export->rows($promotion->name, $result)));
        }

        return ApiResponse::success($result);
    }

    /**
     * Redemptions of a promotion
     *
     * Newest first: `{id, order_id, order_number, customer: {id, name}|null, email, kind
     * (product|order|shipping), amount, coupon_code, created_at}`.
     */
    public function redemptions(Request $request, Promotion $promotion): JsonResponse
    {
        $page = PromotionRedemption::query()->where('promotion_id', $promotion->id)
            ->orderByDesc('created_at')->orderByDesc('id')
            ->paginate(max(1, min(100, (int) $request->query('per_page', 25))));
        $rows = $this->presenter->redemptions($promotion->organization_id, $page->items());

        return ApiResponse::success($rows, meta: ['pagination' => [
            'current_page' => $page->currentPage(),
            'per_page' => $page->perPage(),
            'total' => $page->total(),
            'last_page' => $page->lastPage(),
        ]]);
    }
}
