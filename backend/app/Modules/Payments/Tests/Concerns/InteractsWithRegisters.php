<?php

namespace App\Modules\Payments\Tests\Concerns;

use App\Modules\Payments\Application\Actions\OpenRegisterSession;
use App\Modules\Payments\Domain\SessionStatus;
use App\Modules\Payments\Infrastructure\Models\CashRegister;
use App\Modules\Payments\Infrastructure\Models\RegisterSession;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Users\Infrastructure\Models\User;
use Illuminate\Support\Str;

/**
 * Registers and open sessions for tests that move money.
 */
trait InteractsWithRegisters
{
    protected function register(string $organizationId, string $branchId, ?string $code = null): CashRegister
    {
        return app(TenantContext::class)->runAs($organizationId, fn () => CashRegister::query()->create([
            'branch_id' => $branchId,
            'code' => $code ?? 'R'.Str::upper(Str::random(4)),
            'name' => 'Till '.($code ?? Str::random(3)),
        ]));
    }

    /**
     * The user's open session in the branch, opening one (on a new register) if needed.
     */
    protected function openSession(User $user, string $branchId, string $float = '0.00'): RegisterSession
    {
        $organizationId = (string) $user->organization_id;

        return app(TenantContext::class)->runAs($organizationId, function () use ($user, $organizationId, $branchId, $float) {
            $open = RegisterSession::query()->where('opened_by', $user->id)->where('status', SessionStatus::Open)->first();
            if ($open !== null && $open->branch_id === $branchId) {
                return $open;
            }

            return app(OpenRegisterSession::class)($user->fresh(), $this->register($organizationId, $branchId), $float);
        });
    }
}
