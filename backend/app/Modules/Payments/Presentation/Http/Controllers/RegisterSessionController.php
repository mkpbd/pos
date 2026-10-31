<?php

namespace App\Modules\Payments\Presentation\Http\Controllers;

use App\Modules\Payments\Application\Actions\CloseRegisterSession;
use App\Modules\Payments\Application\Actions\OpenRegisterSession;
use App\Modules\Payments\Application\Actions\RecordCashMovement;
use App\Modules\Payments\Domain\PaymentDirection;
use App\Modules\Payments\Domain\SessionStatus;
use App\Modules\Payments\Infrastructure\Models\CashRegister;
use App\Modules\Payments\Infrastructure\Models\RegisterSession;
use App\Modules\Payments\Presentation\Http\Support\PaymentsPresenter;
use App\Modules\Shared\Application\Contracts\TenantUser;
use App\Modules\Shared\Infrastructure\Http\Queries\ListQuery;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Validation\Rule;

/**
 * Register sessions (shifts): open, cash in/out, close with a cash count, and reports.
 */
class RegisterSessionController
{
    public function __construct(private readonly PaymentsPresenter $presenter) {}

    /**
     * Sessions
     *
     * Filters: `branch_id`, `cash_register_id`, `status`, `opened_by`. With `cash_registers.view`
     * every session of the accessible branches, otherwise one's own.
     */
    public function index(Request $request): JsonResponse
    {
        $request->validate([
            'branch_id' => ['sometimes', 'uuid'],
            'cash_register_id' => ['sometimes', 'uuid'],
            'opened_by' => ['sometimes', 'uuid'],
            'status' => ['sometimes', Rule::enum(SessionStatus::class)],
        ]);
        $query = RegisterSession::query()
            ->when($request->query('branch_id'), fn (Builder $q, string $v) => $q->where('branch_id', $v))
            ->when($request->query('cash_register_id'), fn (Builder $q, string $v) => $q->where('cash_register_id', $v))
            ->when($request->query('opened_by'), fn (Builder $q, string $v) => $q->where('opened_by', $v))
            ->when($request->query('status'), fn (Builder $q, string $v) => $q->where('status', $v));
        $this->presenter->scopeVisibleSessions($query, $this->user($request));

        $page = ListQuery::paginate($query, $request, sortable: ['opened_at', 'number'], searchable: ['number'], defaultSort: '-opened_at');
        $header = $this->presenter->sessionHeaders(collect($page->items()));

        return ApiResponse::paginated($page, fn (RegisterSession $s) => new JsonResource($header($s)));
    }

    /**
     * My open session
     *
     * The caller's open session with its X report, or `null`.
     */
    public function current(Request $request): JsonResponse
    {
        $session = RegisterSession::query()
            ->where('opened_by', $this->user($request)->getAuthIdentifier())
            ->where('status', SessionStatus::Open)
            ->first();

        return ApiResponse::success($session === null ? null : $this->presenter->sessionReport($session));
    }

    /**
     * Session report
     *
     * X report while open, Z report once closed: cash reconciliation, totals per method and per
     * kind of transaction, latest 200 entries.
     */
    public function show(Request $request, RegisterSession $registerSession): JsonResponse
    {
        $this->presenter->assertSessionVisible($this->user($request), $registerSession);

        return ApiResponse::success($this->presenter->sessionReport($registerSession));
    }

    /**
     * Open a session
     *
     * `{opening_float}`. `SESSION_ALREADY_OPEN` when the caller has a session open anywhere,
     * `REGISTER_IN_USE` when someone else is on the register.
     */
    public function open(Request $request, CashRegister $cashRegister, OpenRegisterSession $open): JsonResponse
    {
        $data = $request->validate(['opening_float' => ['required', 'decimal:0,2', 'min:0', 'max:99999999']]);

        return ApiResponse::created($this->presenter->sessionReport($open($this->user($request), $cashRegister, (string) $data['opening_float'])));
    }

    /**
     * Cash in / cash out
     *
     * `{direction: in|out, amount, reason}` on the caller's own open session. Cash out cannot
     * exceed the cash in the drawer (`INSUFFICIENT_CASH`).
     */
    public function cashMovement(Request $request, RegisterSession $registerSession, RecordCashMovement $record): JsonResponse
    {
        $data = $request->validate([
            'direction' => ['required', Rule::enum(PaymentDirection::class)],
            'amount' => ['required', 'decimal:0,2', 'gt:0', 'max:99999999'],
            'reason' => ['required', 'string', 'max:255'],
        ]);
        $session = $record($this->user($request), $registerSession, PaymentDirection::from($data['direction']), (string) $data['amount'], trim($data['reason']));

        return ApiResponse::success($this->presenter->sessionReport($session));
    }

    /**
     * Close a session
     *
     * `{counted_cash, notes?}`. Stores expected cash and the variance (counted − expected).
     */
    public function close(Request $request, RegisterSession $registerSession, CloseRegisterSession $close): JsonResponse
    {
        $data = $request->validate([
            'counted_cash' => ['required', 'decimal:0,2', 'min:0', 'max:99999999'],
            'notes' => ['sometimes', 'nullable', 'string', 'max:1000'],
        ]);
        $session = $close($this->user($request), $registerSession, (string) $data['counted_cash'], filled($data['notes'] ?? null) ? trim($data['notes']) : null);

        return ApiResponse::success($this->presenter->sessionReport($session));
    }

    private function user(Request $request): TenantUser
    {
        /** @var TenantUser */
        return $request->user();
    }
}
