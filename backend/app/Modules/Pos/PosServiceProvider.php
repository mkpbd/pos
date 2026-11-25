<?php

namespace App\Modules\Pos;

use App\Modules\Authentication\Application\Contracts\TillDevices;
use App\Modules\Pos\Application\Contracts\TillApprovals;
use App\Modules\Pos\Application\Services\EloquentTillApprovals;
use App\Modules\Pos\Application\Services\TerminalCookie;
use App\Modules\Pos\Application\Services\TerminalRegistry;
use App\Modules\Pos\Infrastructure\Models\HeldSale;
use App\Modules\Shared\Infrastructure\Providers\ModuleServiceProvider;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Facades\Route;

/**
 * The POS terminal: product grid and scanning, live cart pricing, held carts and the
 * idempotent checkout that hands the cart to the Sales module. POS1a: tills (devices for PIN
 * sign-in) and manager approvals by PIN.
 */
class PosServiceProvider extends ModuleServiceProvider
{
    public function register(): void
    {
        // POS1a: tills for the PIN sign-in (Authentication declares the contract) and manager approvals for Sales.
        $this->app->bind(TillDevices::class, TerminalRegistry::class);
        $this->app->bind(TillApprovals::class, EloquentTillApprovals::class);
    }

    public function boot(): void
    {
        Route::model('heldSale', HeldSale::class);

        // POS1a: the till's sign-in screen (no sign-in yet) and PIN approvals.
        RateLimiter::for('pos-terminal', fn (Request $request) => Limit::perMinute(60)->by('pos-terminal:'.(TerminalCookie::tokenHash($request) ?? $request->ip())));
        RateLimiter::for('pos-approval', fn (Request $request) => [
            Limit::perMinute(10)->by('pos-approval:requester:'.($request->user()?->getAuthIdentifier() ?? $request->ip())),
            Limit::perMinute(10)->by('pos-approval:approver:'.(is_string($request->input('approver_id')) ? $request->input('approver_id') : '')),
        ]);

        parent::boot();
    }

    protected function permissions(): array
    {
        return [
            'pos.sell' => 'Use the POS terminal: look up products, hold carts and check out sales',
            'pos.terminals.manage' => 'Set up and remove till devices',
        ];
    }
}
