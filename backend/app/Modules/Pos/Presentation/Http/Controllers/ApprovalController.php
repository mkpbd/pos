<?php

namespace App\Modules\Pos\Presentation\Http\Controllers;

use App\Modules\Authentication\Domain\Pin\PinRules;
use App\Modules\Pos\Application\Actions\GiveApproval;
use App\Modules\Pos\Application\Contracts\TillApprovals;
use App\Modules\Shared\Application\Contracts\TenantUser;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * POS1a: manager approval at the till — a manager picks their name and types their PIN on the
 * cashier's screen; the approval id then goes with the cart (`price_approval_id` on a line,
 * `discount_approval_id` on the cart).
 */
class ApprovalController
{
    private const ACTIONS = [TillApprovals::PRICE_OVERRIDE, TillApprovals::DISCOUNT];

    /**
     * Who can approve
     *
     * Active users with a PIN, the action's permission (`price_override` → `sales.price_override`,
     * `discount` → `sales.discount`) and access to the store's branch — not the requester.
     */
    public function approvers(Request $request, GiveApproval $approvals): JsonResponse
    {
        $data = $request->validate([
            'action' => ['required', Rule::in(self::ACTIONS)],
            'store_id' => ['required', 'uuid'],
        ]);

        return ApiResponse::success($approvals->approvers($this->user($request), $data['action'], $data['store_id']));
    }

    /**
     * Approve with a manager's PIN
     *
     * Valid for 10 minutes, used once by the requester's checkout. `price_override` needs
     * `details.variant_id`; `discount` may say `details.scope` (`line` / `invoice`). Errors:
     * `APPROVER_NOT_ALLOWED`, `PIN_INVALID` (`details.attempts_left`), `PIN_LOCKED` (423,
     * `details.retry_after`), `PIN_NOT_SET`.
     */
    public function store(Request $request, GiveApproval $give): JsonResponse
    {
        $data = $request->validate([
            'action' => ['required', Rule::in(self::ACTIONS)],
            'approver_id' => ['required', 'uuid'],
            'pin' => ['required', 'string', 'max:'.PinRules::MAX_LENGTH],
            'store_id' => ['required', 'uuid'],
            'details' => ['sometimes', 'nullable', 'array'],
            'details.variant_id' => ['required_if:action,'.TillApprovals::PRICE_OVERRIDE, 'nullable', 'uuid'],
            'details.unit_price' => ['sometimes', 'nullable', 'decimal:0,2', 'min:0.01', 'max:99999999.99'],
            'details.scope' => ['sometimes', 'nullable', Rule::in(['line', 'invoice'])],
        ]);

        return ApiResponse::created($give($this->user($request), $data));
    }

    private function user(Request $request): TenantUser
    {
        /** @var TenantUser */
        return $request->user();
    }
}
