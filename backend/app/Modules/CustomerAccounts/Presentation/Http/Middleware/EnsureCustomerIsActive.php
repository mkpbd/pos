<?php

namespace App\Modules\CustomerAccounts\Presentation\Http\Middleware;

use App\Modules\CustomerAccounts\Application\Actions\CustomerSession;
use App\Modules\CustomerAccounts\Infrastructure\Models\CustomerAccount;
use App\Modules\Customers\Application\Actions\OnlineCustomerProfiles;
use Closure;
use Illuminate\Auth\AuthenticationException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Symfony\Component\HttpFoundation\Response;

/**
 * Rejects a signed-in shopper whose account staff disabled (or whose customer record was
 * archived or deactivated) since signing in: the customer is signed out and the request
 * answered 401. With `customer.active:optional` the request continues as a guest instead.
 */
class EnsureCustomerIsActive
{
    public function __construct(
        private readonly CustomerSession $session,
        private readonly OnlineCustomerProfiles $customers,
    ) {}

    public function handle(Request $request, Closure $next, string $mode = 'required'): Response
    {
        $account = Auth::guard('customer')->user();

        if ($account instanceof CustomerAccount && (! $account->isActive() || ! $this->customers->isUsable($account->customer_id))) {
            $this->session->logout();
            if ($mode !== 'optional') {
                throw new AuthenticationException('Unauthenticated.', ['customer']);
            }
        }

        return $next($request);
    }
}
