<?php

namespace App\Modules\Payments\Presentation\Http\Controllers;

use App\Modules\Branches\Application\Contracts\BranchDirectory;
use App\Modules\Payments\Infrastructure\Models\CashRegister;
use App\Modules\Payments\Presentation\Http\Support\PaymentsPresenter;
use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Application\Contracts\TenantUser;
use App\Modules\Shared\Application\Support\Changes;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use App\Modules\Shared\Infrastructure\Validation\TenantUnique;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\AccessDeniedHttpException;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

/**
 * Registers (tills) of the branches, with the session currently running on each.
 */
class CashRegisterController
{
    public function __construct(
        private readonly TenantContext $tenant,
        private readonly PaymentsPresenter $presenter,
        private readonly AuditTrail $audit,
    ) {}

    /**
     * Registers
     *
     * Registers of the accessible branches (`branch_id` to narrow), each with its open session.
     * Needs any of `cash_registers.view`, `.operate` or `.manage`.
     */
    public function index(Request $request): JsonResponse
    {
        $user = $this->user($request);
        if (! Gate::forUser($user)->any(['cash_registers.view', 'cash_registers.operate', 'cash_registers.manage'])) {
            throw new AccessDeniedHttpException;
        }
        $request->validate(['branch_id' => ['sometimes', 'uuid']]);

        $accessible = $user->accessibleBranchIds();
        $registers = CashRegister::query()
            ->when($accessible !== null, fn (Builder $q) => $q->whereIn('branch_id', $accessible))
            ->when($request->query('branch_id'), fn (Builder $q, string $v) => $q->where('branch_id', $v))
            ->orderBy('code')
            ->get();

        return ApiResponse::success($this->presenter->registers($registers));
    }

    public function store(Request $request, BranchDirectory $branches): JsonResponse
    {
        $data = $request->validate([
            'branch_id' => ['required', 'uuid'],
            'code' => ['required', 'string', 'max:20', new TenantUnique('cash_registers', 'code')],
            'name' => ['required', 'string', 'max:100'],
            'is_active' => ['sometimes', 'boolean'],
        ]);
        if (! $branches->isActiveBranchOf($data['branch_id'], $this->tenant->requireOrganization()) || ! $this->user($request)->canAccessBranch($data['branch_id'])) {
            throw ValidationException::withMessages(['branch_id' => ['The selected branch does not exist.']]);
        }

        return ApiResponse::created($this->presenter->registers(collect([$this->save(new CashRegister, $data)]))[0]);
    }

    public function update(Request $request, CashRegister $cashRegister): JsonResponse
    {
        if (! $this->user($request)->canAccessBranch($cashRegister->branch_id)) {
            throw new NotFoundHttpException;
        }
        $data = $request->validate([
            'code' => ['sometimes', 'string', 'max:20', new TenantUnique('cash_registers', 'code', $cashRegister->id)],
            'name' => ['sometimes', 'string', 'max:100'],
            'is_active' => ['sometimes', 'boolean'],
        ]);

        return ApiResponse::success($this->presenter->registers(collect([$this->save($cashRegister, $data)]))[0]);
    }

    /**
     * @param  array<string, mixed>  $attributes
     */
    private function save(CashRegister $register, array $attributes): CashRegister
    {
        return DB::transaction(function () use ($register, $attributes) {
            $creating = ! $register->exists;
            $before = $creating ? [] : $register->only(['code', 'name', 'is_active']);
            $register->fill(array_map(fn ($v) => is_string($v) ? trim($v) : $v, $attributes))->save();
            [$old, $new] = Changes::between($before, $register->only(['code', 'name', 'is_active']));
            if ($creating || $new !== []) {
                $this->audit->record($creating ? 'cash_register.created' : 'cash_register.updated', $register, $old, $new);
            }

            return $register;
        });
    }

    private function user(Request $request): TenantUser
    {
        /** @var TenantUser */
        return $request->user();
    }
}
