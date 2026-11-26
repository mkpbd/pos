<?php

namespace App\Modules\Pos\Presentation\Http\Controllers;

use App\Modules\Pos\Application\Actions\OpenDrawer;
use App\Modules\Pos\Application\Queries\DrawerOpeningList;
use App\Modules\Pos\Application\Services\TerminalRegistry;
use App\Modules\Pos\Infrastructure\Models\DrawerOpening;
use App\Modules\Shared\Application\Contracts\TenantUser;
use App\Modules\Shared\Infrastructure\Http\Queries\ListQuery;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Support\Facades\Gate;
use Symfony\Component\HttpKernel\Exception\AccessDeniedHttpException;

/**
 * POS1d: the cash drawer opened at the till without a sale ("no sale").
 */
class DrawerOpeningController
{
    /**
     * No-sale drawer openings
     *
     * Newest first, in the user's branches. Filters: `branch_id`, `register_session_id`,
     * `user_id`, `from` / `to` (Y-m-d, the organization's days). Needs `cash_registers.view` or
     * `pos.no_sale`.
     */
    public function index(Request $request, DrawerOpeningList $list): JsonResponse
    {
        $user = $this->user($request);
        if (! Gate::forUser($user)->any(['cash_registers.view', 'pos.no_sale'])) {
            throw new AccessDeniedHttpException;
        }
        $filters = $request->validate([
            'branch_id' => ['sometimes', 'uuid'],
            'register_session_id' => ['sometimes', 'uuid'],
            'user_id' => ['sometimes', 'uuid'],
            'from' => ['sometimes', 'date_format:Y-m-d'],
            'to' => ['sometimes', 'date_format:Y-m-d', 'after_or_equal:from'],
        ]);
        $page = $list->paginate($user, $filters, ListQuery::perPage($request));
        $present = $list->presenter(collect($page->items()));

        return ApiResponse::paginated($page, fn (DrawerOpening $o) => new JsonResource($present($o)));
    }

    /**
     * Open the drawer without a sale
     *
     * `{store_id, reason, approval_id?}` — records the opening on the caller's open register
     * session in the store's branch (no money moves). Without `pos.no_sale` it needs a manager's
     * `no_sale` approval (`POST /pos/approvals`), used once. Errors: `APPROVAL_REQUIRED`
     * (`details.action: no_sale`), `APPROVAL_INVALID`, `CASH_SESSION_REQUIRED`.
     */
    public function store(Request $request, OpenDrawer $open, TerminalRegistry $tills): JsonResponse
    {
        $data = $request->validate([
            'store_id' => ['required', 'uuid'],
            'reason' => ['required', 'string', 'max:200'],
            'approval_id' => ['sometimes', 'nullable', 'uuid'],
        ]);
        $data['reason'] = trim($data['reason']);

        return ApiResponse::created($open($this->user($request), $data, $tills->fromRequest($request)));
    }

    private function user(Request $request): TenantUser
    {
        /** @var TenantUser */
        return $request->user();
    }
}
