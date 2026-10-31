<?php

namespace App\Modules\Promotions\Presentation\Http\Controllers;

use App\Modules\Promotions\Application\Actions\ManageCoupons;
use App\Modules\Promotions\Infrastructure\Models\Coupon;
use App\Modules\Promotions\Infrastructure\Models\Promotion;
use App\Modules\Promotions\Presentation\Http\Support\PromotionPresenter;
use App\Modules\Shared\Infrastructure\Http\Queries\ListQuery;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * Codes of coupon promotions. Viewing needs `promotions.view`, changes `promotions.manage`.
 */
class CouponController
{
    /**
     * Coupon codes of a promotion
     *
     * `search` matches the code. Rows `{id, code, usage_limit, used_count, is_active, created_at}`,
     * by code (`sort`: code, created_at, used_count; `-` for descending).
     */
    public function index(Request $request, Promotion $promotion): JsonResponse
    {
        $page = ListQuery::paginate($promotion->coupons()->getQuery(), $request, sortable: ['created_at', 'code', 'used_count'], searchable: ['code'], defaultSort: 'code');

        return ApiResponse::paginated($page, fn (Coupon $c) => new JsonResource(PromotionPresenter::coupon($c)));
    }

    /**
     * Add coupon codes
     *
     * Either `{code, usage_limit?}` (one code; upper-cased, 3–40 letters, digits or hyphens,
     * unique in the organization) or `{generate: 1–500, prefix?, usage_limit?}` (random
     * 8-character codes after the prefix). 201 with the created codes (rows as in the list).
     * `NOT_A_COUPON_PROMOTION` for automatic promotions.
     */
    public function store(Request $request, Promotion $promotion, ManageCoupons $coupons): JsonResponse
    {
        $data = $request->validate([
            'code' => ['required_without:generate', 'prohibits:generate', 'string', 'max:40'],
            'generate' => ['required_without:code', 'integer', 'min:1', 'max:'.ManageCoupons::MAX_GENERATE],
            'prefix' => ['sometimes', 'nullable', 'string', 'regex:/^[A-Za-z0-9-]{0,32}$/'],
            'usage_limit' => ['sometimes', 'nullable', 'integer', 'min:1', 'max:1000000000'],
        ]);
        $limit = isset($data['usage_limit']) ? (int) $data['usage_limit'] : null;

        $created = isset($data['code'])
            ? [$coupons->add($promotion, (string) $data['code'], $limit)]
            : $coupons->generate($promotion, (int) $data['generate'], (string) ($data['prefix'] ?? ''), $limit);

        return ApiResponse::created(array_map(fn (Coupon $c) => PromotionPresenter::coupon($c->refresh()), $created));
    }

    /**
     * Change a coupon code
     *
     * `{is_active?, usage_limit?}` (null = unlimited).
     */
    public function update(Request $request, Coupon $coupon, ManageCoupons $coupons): JsonResponse
    {
        $data = $request->validate([
            'is_active' => ['sometimes', 'boolean'],
            'usage_limit' => ['sometimes', 'nullable', 'integer', 'min:1', 'max:1000000000'],
        ]);
        if (array_key_exists('is_active', $data)) {
            $data['is_active'] = $request->boolean('is_active');
        }
        if (isset($data['usage_limit'])) {
            $data['usage_limit'] = (int) $data['usage_limit'];
        }

        return ApiResponse::success(PromotionPresenter::coupon($coupons->update($coupon, $data)));
    }

    /**
     * Delete a coupon code
     *
     * Unused codes only (`IN_USE` otherwise: deactivate it instead).
     */
    public function destroy(Coupon $coupon, ManageCoupons $coupons): JsonResponse
    {
        $coupons->delete($coupon);

        return ApiResponse::noContent();
    }
}
