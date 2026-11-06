<?php

namespace App\Modules\Loyalty;

use App\Modules\Loyalty\Application\Contracts\LoyaltyBalances;
use App\Modules\Loyalty\Application\Services\EloquentLoyaltyBalances;
use App\Modules\Loyalty\Application\Services\EloquentLoyaltyProgram;
use App\Modules\Sales\Application\Contracts\LoyaltyProgram;
use App\Modules\Shared\Infrastructure\Providers\ModuleServiceProvider;

/**
 * Customer loyalty points: earned on sales, redeemed as a way to pay, reversed with
 * cancellations and returns. Plugs into Sales through Sales' LoyaltyProgram contract.
 */
class LoyaltyServiceProvider extends ModuleServiceProvider
{
    public function register(): void
    {
        $this->app->bind(LoyaltyProgram::class, EloquentLoyaltyProgram::class);
        // Phase 8: balances for the AI customer insights.
        $this->app->bind(LoyaltyBalances::class, EloquentLoyaltyBalances::class);
    }

    protected function permissions(): array
    {
        return [
            'loyalty.view' => 'View the loyalty program and customer point balances',
            'loyalty.manage' => 'Configure the loyalty program and adjust customer points',
        ];
    }
}
