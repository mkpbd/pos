<?php

namespace App\Modules\Orders\Presentation\Http\Controllers;

use App\Modules\Orders\Application\Actions\BlockedPhones;
use App\Modules\Orders\Application\Queries\PhoneDeliveryReport;
use App\Modules\Orders\Infrastructure\Models\BlockedPhone;
use App\Modules\Shared\Domain\BangladeshMobile;
use App\Modules\Shared\Infrastructure\Http\Queries\ListQuery;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use App\Modules\Users\Application\Contracts\UserDirectory;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Validation\ValidationException;

/**
 * BD1b: cash-on-delivery fraud controls for staff — the organization's blocked mobile numbers
 * and the delivery history of a number.
 */
class BlockedPhoneController
{
    /**
     * Blocked numbers
     *
     * `?search=` (digits of the number or words of the reason) `&page=`. Newest first, 25 per
     * page. Rows: `{id, phone, reason, created_by: {id, name}|null, created_at}`.
     */
    public function index(Request $request, UserDirectory $users): JsonResponse
    {
        $request->validate(['search' => ['sometimes', 'nullable', 'string', 'max:100']]);
        $search = trim((string) $request->query('search', ''));
        // "+880 1712…" matches the stored national form "01712…".
        $digits = preg_replace('/^88(?=0)/', '', preg_replace('/\D/', '', $search) ?? '') ?? '';

        $page = BlockedPhone::query()
            ->when($search !== '', fn (Builder $q) => $q->where(function (Builder $w) use ($search, $digits) {
                if ($digits !== '') {
                    $w->orWhereLike('phone', '%'.$digits.'%');
                }
                $w->orWhereLike('reason', '%'.addcslashes($search, '%_\\').'%');
            }))
            ->orderByDesc('created_at')->orderByDesc('id')
            ->paginate(ListQuery::perPage($request));
        $items = collect($page->items());
        $names = $users->names((string) $items->first()?->organization_id, $items->pluck('created_by')->filter()->unique()->values()->all());

        return ApiResponse::paginated($page, fn (BlockedPhone $b) => new JsonResource(self::present($b, $names)));
    }

    /**
     * Block a number
     *
     * `{phone, reason? (≤ 200)}`. Shop and landing-page orders to this number (contact or
     * delivery phone) can no longer be paid with cash on delivery (`COD_NOT_AVAILABLE`); staff
     * orders only show the warning. 422 on `phone`: not a Bangladeshi mobile number, or
     * "This number is already blocked.". 201 the row.
     */
    public function store(Request $request, BlockedPhones $blocked, UserDirectory $users): JsonResponse
    {
        $data = $request->validate([
            'phone' => ['required', 'string', 'max:30'],
            'reason' => ['sometimes', 'nullable', 'string', 'max:200'],
        ]);
        $actor = (string) $request->user()->getAuthIdentifier();
        $row = $blocked->add($data['phone'], $data['reason'] ?? null, $actor);

        return ApiResponse::created(self::present($row, $users->names($row->organization_id, [$actor])));
    }

    /**
     * Unblock a number
     */
    public function destroy(BlockedPhone $blockedPhone, BlockedPhones $blocked): JsonResponse
    {
        $blocked->remove($blockedPhone);

        return ApiResponse::noContent();
    }

    /**
     * Delivery history of a mobile number
     *
     * `?phone=` (any common form: 01712345678, +8801712345678…) → `{phone, orders, delivered,
     * returned, cancelled, in_progress, success_rate, last_order_at, blocked, block_reason}` over
     * the organization's web orders with that contact phone. Each order counts once: delivered,
     * returned (the courier brought the parcel back), cancelled (without a returned parcel) or in
     * progress. `success_rate` = round(100 × delivered / (delivered + returned)), null while
     * both are 0. 422 on `phone` when it is not a Bangladeshi mobile number.
     */
    public function phoneReport(Request $request, PhoneDeliveryReport $report): JsonResponse
    {
        $request->validate(['phone' => ['required', 'string', 'max:30']]);
        $phone = BangladeshMobile::normalize((string) $request->query('phone'));
        if ($phone === null) {
            throw ValidationException::withMessages(['phone' => ['Enter a Bangladeshi mobile number, e.g. 01712345678.']]);
        }

        return ApiResponse::success($report->forPhone($phone));
    }

    /**
     * @param  array<string, string>  $names
     * @return array<string, mixed>
     */
    private static function present(BlockedPhone $b, array $names): array
    {
        return [
            'id' => $b->id,
            'phone' => $b->phone,
            'reason' => $b->reason,
            'created_by' => $b->created_by === null ? null : ['id' => $b->created_by, 'name' => $names[$b->created_by] ?? null],
            'created_at' => $b->created_at->toIso8601String(),
        ];
    }
}
